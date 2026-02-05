require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: [
    "http://localhost:5173",
    
  ],
  credentials: true,
}));
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@assetverse.wvltwxx.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    console.log("✅ MongoDB Connected");

    const db = client.db("assetverse");

    // Collections
    const userCollection     = db.collection("users");
    const packagesCollection = db.collection("packages");
    const assetsCollection   = db.collection("assets");
    const requestsCollection = db.collection("requests");
    const assignedCollection = db.collection("assignedAssets");
    const paymentsCollection = db.collection("payments");

    // ─── Default Packages Seed ───────────────────────────────
    const packageCount = await packagesCollection.countDocuments();
    if (packageCount === 0) {
      const defaultPackages = [
        { name: "Basic", price: 5, employeeLimit: 5, features: ["5 Employees", "Basic Tracking"], createdAt: new Date() },
        { name: "Pro",   price: 10, employeeLimit: 10, features: ["10 Employees", "Priority Support"], createdAt: new Date() },
        { name: "Enterprise", price: 15, employeeLimit: 15, features: ["15 Employees", "Full Access"], createdAt: new Date() },
      ];
      await packagesCollection.insertMany(defaultPackages);
      console.log("✅ Default packages inserted");
    }

    // ─── JWT Middlewares ─────────────────────────────────────
    const verifyJWT = (req, res, next) => {
      const token = req.headers.authorization?.split(" ")[1];
      if (!token) return res.status(401).json({ message: "No token provided" });

      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ message: "Invalid/expired token" });
        req.user = decoded;
        next();
      });
    };

    const verifyHR = (req, res, next) => {
      if (req.user.role !== "hr") {
        return res.status(403).json({ message: "HR access only" });
      }
      next();
    };

    // ─── Routes ──────────────────────────────────────────────

    app.get("/", (req, res) => res.send("AssetVerse Server Running..."));

    // ─── Auth / Users ────────────────────────────────────────
    app.post("/users", async (req, res) => {
      const user = req.body;
      const existing = await userCollection.findOne({ email: user.email });
      if (existing) return res.send({ message: "user already exists", insertedId: null });

      user.createdAt = new Date();
      user.updatedAt = new Date();
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.post("/register/hr", async (req, res) => {
      const { name, email, password, companyName, companyLogo, dateOfBirth } = req.body;
      const existing = await userCollection.findOne({ email });
      if (existing) return res.status(400).json({ message: "Email already exists" });

      const hr = {
        name,
        email,
        password,           
        role: "hr",
        companyName,
        companyLogo: companyLogo || "",
        packageLimit: 5,
        currentEmployees: 0,
        subscription: "basic",
        dateOfBirth,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await userCollection.insertOne(hr);
      const token = jwt.sign({ id: result.insertedId, role: "hr", email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1d" });
      res.status(201).json({ message: "HR Registered", token });
    });

    app.post("/register/employee", async (req, res) => {
      const { name, email, password, dateOfBirth } = req.body;
      const existing = await userCollection.findOne({ email });
      if (existing) return res.status(400).json({ message: "Email already exists" });

      const emp = {
        name,
        email,
        password,           
        role: "employee",
        dateOfBirth,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await userCollection.insertOne(emp);
      const token = jwt.sign({ id: result.insertedId, role: "employee", email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1d" });
      res.status(201).json({ message: "Employee Registered", token });
    });

    app.post("/login", async (req, res) => {
      const { email, password } = req.body;
      const user = await userCollection.findOne({ email });
      if (!user || user.password !== password) {
        return res.status(400).json({ message: "Invalid Credentials" });
      }

      const token = jwt.sign({ id: user._id, role: user.role, email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1d" });
      res.json({ message: "Login Success", token });
    });

    app.post("/jwt", async (req, res) => {
  const { email } = req.body;
  const user = await userCollection.findOne({ email });

  if (!user) {
    return res.status(404).json({ message: "User not found in DB" });
  }

  const token = jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: "1d" }
  );

  res.json({ token });
});


   app.get("/users/:email", verifyJWT, async (req, res) => {
  if (req.user.email !== req.params.email) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const user = await userCollection.findOne({ email: req.params.email });
  if (!user) return res.status(404).json({ message: "User not found" });

  const { password, ...safe } = user;
  res.json(safe);
});



   app.get("/users/:email/role", verifyJWT, async (req, res) => {
  if (req.user.email !== req.params.email) {
    return res.status(403).json({ message: "Forbidden" });
  }

  const user = await userCollection.findOne({ email: req.params.email });
  res.json({ role: user?.role || "employee" });
});


    // ─── Packages ────────────────────────────────────────────
    app.get("/packages", async (req, res) => {
      const packages = await packagesCollection.find().toArray();
      res.json(packages);
    });
    // seed package route 
    app.get("/packages/hr", async (req, res) => {
  try {
    const packages = await packagesCollection.find().toArray();
    res.json(packages);
  } catch (err) {
    console.error("Get HR packages error:", err);
    res.status(500).json({ message: "Failed to fetch packages" });
  }
});

    // ─── Assets ──────────────────────────────────────────────
   // Add asset (HR only)
app.post("/assets", verifyJWT, verifyHR, async (req, res) => {
  try {
    const {
      productName,
      productImage,
      productType,
      productQuantity,
      hrEmail,
      companyName,
      companyLogo
    } = req.body;

    // Validate required fields
    if (!productName || !productType || !productQuantity || !hrEmail || !companyName) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Ensure HR exists in DB
    const hr = await userCollection.findOne({ email: hrEmail });
    if (!hr || hr.role !== "hr") {
      return res.status(403).json({ message: "HR not found or unauthorized" });
    }

    // Create asset object
    const asset = {
      productName,
      productImage: productImage || "",
      productType,
      productQuantity: Number(productQuantity),
      availableQuantity: Number(productQuantity),
      hrEmail,
      companyName,
      companyLogo: companyLogo || "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await assetsCollection.insertOne(asset);

    res.status(201).json({
      message: "Asset created successfully",
      assetId: result.insertedId,
      asset,
    });
  } catch (err) {
    console.error("Add Asset Error:", err);
    res.status(500).json({ message: "Failed to add asset" });
  }
});
//+========MY emplioyye Route===========
// ─── Get Approved Employees for HR ─────────────────────
app.get("/employees", verifyJWT, verifyHR, async (req, res) => {
  try {
    const hrEmail = req.user.email;

    const employees = await userCollection.find({
      role: "employee",
      hrEmail: hrEmail,
      status: "approved",
    }).toArray();

    res.json(employees);
  } catch (error) {
    console.error("Get employees error:", error);
    res.status(500).json({ message: "Failed to load employees" });
  }
});

// ─── Remove Employee (HR) ──────────────────────────────
app.delete("/employees/:id", verifyJWT, verifyHR, async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid employee ID" });
    }

    const result = await userCollection.updateOne(
      {
        _id: new ObjectId(id),
        role: "employee",
        hrEmail: req.user.email,
      },
      {
        $set: { status: "removed", updatedAt: new Date() },
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ message: "Employee not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Remove employee error:", error);
    res.status(500).json({ message: "Failed to remove employee" });
  }
});

// ─── Approve Employee Request ──────────────────────────
app.post("/employee-requests/:id/approve", verifyJWT, verifyHR, async (req, res) => {
  try {
    const request = await requestsCollection.findOne({
      _id: new ObjectId(req.params.id),
    });

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    // ✅ UPDATE EMPLOYEE USER DOCUMENT
    await userCollection.updateOne(
      { email: request.requesterEmail },
      {
        $set: {
          status: "approved",
          hrEmail: req.user.email,
          updatedAt: new Date(),
        },
      }
    );

    // mark request approved
    await requestsCollection.updateOne(
      { _id: request._id },
      {
        $set: {
          requestStatus: "approved",
          approvedAt: new Date(),
          approvedBy: req.user.email,
        },
      }
    );

    res.json({ success: true, message: "Employee approved" });
  } catch (err) {
    console.error("Approve employee error:", err);
    res.status(500).json({ message: "Failed to approve employee" });
  }
});
///^^^^^^ MOngo Ck kore Employee list ante hobe //





    //============================================
   app.get("/assets", verifyJWT, async (req, res) => {
  if (req.user.role === "hr") {
    const assets = await assetsCollection.find({ hrEmail: req.user.email }).toArray();
    return res.json(assets);
  }

  const assets = await assetsCollection.find().toArray();
  res.json(assets);
});



    app.get("/assets/public", async (req, res) => {
      const { searchText = "", limit = 10, skip = 0 } = req.query;
      const query = searchText ? { productName: { $regex: searchText, $options: "i" } } : {};
      const total = await assetsCollection.countDocuments(query);
      const assets = await assetsCollection.find(query).skip(Number(skip)).limit(Number(limit)).toArray();
      res.json({ assets, total });
    });

    app.patch("/assets/:id", verifyJWT, verifyHR, async (req, res) => {
      const result = await assetsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { ...req.body, updatedAt: new Date() } }
      );
      res.json(result);
    });

  // Delete a request by ID (HR only)
app.delete("/requests/:id", verifyJWT, verifyHR, async (req, res) => {
  try {
    const id = req.params.id;

    // Check if ID is valid ObjectId
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid request ID" });
    }

    const result = await requestsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Request not found or already deleted" });
    }

    res.json({ message: "Request deleted successfully" });
  } catch (err) {
    console.error("Delete request error:", err);
    res.status(500).json({ message: "Failed to delete request" });
  }
});

app.delete("/assets/:id", verifyJWT, verifyHR, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid asset ID" });

    const result = await assetsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Asset not found or already deleted" });
    }

    res.json({ message: "Asset deleted successfully", deletedCount: result.deletedCount });
  } catch (err) {
    console.error("Delete asset error:", err);
    res.status(500).json({ message: "Failed to delete asset" });
  }
});

    // ─── Requests ────────────────────────────────────────────
    app.post("/requests", verifyJWT, async (req, res) => {
      const { assetId, note = "" } = req.body;
      const asset = await assetsCollection.findOne({ _id: new ObjectId(assetId) });
      if (!asset) return res.status(404).json({ message: "Asset not found" });

      const exists = await requestsCollection.findOne({
        assetId: new ObjectId(assetId),
        requesterEmail: req.user.email,
        requestStatus: "pending"
      });
      if (exists) return res.status(400).json({ message: "Request already pending" });

      const request = {
        assetId: asset._id,
        assetName: asset.productName,
        assetImage: asset.productImage || "",
        assetType: asset.productType,
        requesterEmail: req.user.email,
        requesterName: req.user.name || req.user.email,
        hrEmail: asset.hrEmail,
        companyName: asset.companyName,
        note,
        requestDate: new Date(),
        requestStatus: "pending"
      };

      const result = await requestsCollection.insertOne(request);
      res.status(201).json({ message: "Request Sent", requestId: result.insertedId });
    });

    app.get("/asset-requests/hr", verifyJWT, verifyHR, async (req, res) => {
      const requests = await requestsCollection.find({ hrEmail: req.user.email }).sort({ requestDate: -1 }).toArray();
      res.json(requests);
    });

    app.get("/asset-requests/employee", verifyJWT, async (req, res) => {
      const requests = await requestsCollection.find({ requesterEmail: req.user.email }).sort({ requestDate: -1 }).toArray();
      res.json(requests);
    });

    app.post("/requests/:id/approve", verifyJWT, verifyHR, async (req, res) => {
      const request = await requestsCollection.findOne({ _id: new ObjectId(req.params.id) });
      if (!request || request.requestStatus !== "pending") return res.status(400).json({ message: "Invalid request" });

      const asset = await assetsCollection.findOne({ _id: request.assetId });
      if (!asset || asset.availableQuantity <= 0) return res.status(400).json({ message: "No stock" });

      await assignedCollection.insertOne({
        ...request,
        employeeEmail: request.requesterEmail,
        employeeName: request.requesterName,
        assignmentDate: new Date(),
        status: "assigned"
      });

      await assetsCollection.updateOne({ _id: asset._id }, { $inc: { availableQuantity: -1 } });
      await requestsCollection.updateOne(
        { _id: request._id },
        { $set: { requestStatus: "approved", approvalDate: new Date(), processedBy: req.user.email } }
      );

      res.json({ message: "Approved" });
    });

    app.patch("/requests/:id/reject", verifyJWT, verifyHR, async (req, res) => {
      await requestsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { requestStatus: "rejected", processedBy: req.user.email, approvalDate: new Date() } }
      );
      res.json({ success: true });
    });

    // ─── Stripe Payment ──────────────────────────────────────
    app.post("/create-checkout-session", verifyJWT, async (req, res) => {
      const { packageId } = req.body;
      const pkg = await packagesCollection.findOne({ _id: new ObjectId(packageId) });
      if (!pkg) return res.status(404).json({ message: "Package not found" });

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: pkg.name, description: `Limit: ${pkg.employeeLimit}` },
            unit_amount: pkg.price * 100,
          },
          quantity: 1,
        }],
        metadata: { userId: req.user.id, packageId: pkg._id.toString() },
        success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
      });

      res.json({ url: session.url });
    });

    app.patch("/payment-success", async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== "paid") return res.status(400).json({ message: "Payment not completed" });

      const { userId, packageId } = session.metadata;
      const pkg = await packagesCollection.findOne({ _id: new ObjectId(packageId) });

      await userCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { packageName: pkg.name, packageLimit: pkg.employeeLimit, subscription: "active", updatedAt: new Date() } }
      );

      await paymentsCollection.insertOne({
        userId: new ObjectId(userId),
        packageName: pkg.name,
        amount: pkg.price,
        transactionId: session.id,
        paymentDate: new Date(),
        status: "completed"
      });

      res.json({ success: true });
    });

    // ─── Server Started Message ──────────────────────────────
    console.log("All routes loaded inside run()");
  } catch (err) {
    console.error("Error in run():", err);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`🚀 AssetVerse server running on port ${port}`);
});