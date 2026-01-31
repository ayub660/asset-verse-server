require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const app = express();
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://asset-verse-clients.netlify.app"
  ],
  credentials: true,
}));
app.use(express.json());
// ---------------------------
// MongoDB Connect
// MongoDB Connect
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@assetverse.wvltwxx.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri);

let db; 

async function connectDB() {
  try {
    await client.connect();
    db = client.db("assetverse"); 
    console.log("✅ MongoDB Connected");

    await insertPackages();

  } catch (err) {
    console.log("❌ MongoDB Error:", err);
  }
}

connectDB();

// ---------------------------
// Insert default packages
async function insertPackages() {
  try {
    // এখানে চেক করছি db আসলে সেট হয়েছে কি না
    if (!db) {
      console.log("⚠️ DB not ready yet, skipping insert.");
      return;
    }

    const packageCollection = db.collection("packages");
    const count = await packageCollection.countDocuments();
    
    if (count === 0) {
      const defaultPackages = [
        { name: "Basic Plan", price: 5, employeeLimit: 5, createdAt: new Date() },
        { name: "Pro Plan", price: 10, employeeLimit: 10, createdAt: new Date() },
        { name: "Enterprise Plan", price: 15, employeeLimit: 15, createdAt: new Date() },
      ];
      const result = await packageCollection.insertMany(defaultPackages);
      console.log("✅ Packages synchronized with DB:", result.insertedCount);
    }
  } catch (err) {
    console.error("❌ Insert Packages Error:", err);
  }
}


// ---------------------------
// JWT Middleware
function verifyJWT(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: "Forbidden" });
    req.user = decoded;
    next();
  });
}

function verifyHR(req, res, next) {
  if (req.user.role !== "hr") return res.status(403).json({ message: "HR Only" });
  next();
}

// ---------------------------
// Routes
app.get("/", (req, res) => res.send("AssetVerse Server Running..."));

// ---------------------------
// HR Registration
app.post("/register/hr", async (req, res) => {
  try {
    const { name, email, password, companyName, companyLogo, dateOfBirth } = req.body;
    const existing = await db.collection("users").findOne({ email });
    if (existing) return res.status(400).json({ message: "Email already exists" });

    const hr = {
      name,
      email,
      password, // plain text
      role: "hr",
      companyName,
      companyLogo,
      packageLimit: 5,
      currentEmployees: 0,
      subscription: "basic",
      dateOfBirth,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection("users").insertOne(hr);
    const token = jwt.sign({ id: result.insertedId, role: "hr", email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1d" });
    res.status(201).json({ message: "HR Registered", token });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

// ---------------------------
// Employee Registration
app.post("/register/employee", async (req, res) => {
  try {
    const { name, email, password, dateOfBirth } = req.body;
    const existing = await db.collection("users").findOne({ email });
    if (existing) return res.status(400).json({ message: "Email already exists" });

    const emp = {
      name,
      email,
      password, // plain text
      role: "employee",
      dateOfBirth,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection("users").insertOne(emp);
    const token = jwt.sign({ id: result.insertedId, role: "employee", email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1d" });
    res.status(201).json({ message: "Employee Registered", token });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

// ---------------------------
// Login
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.collection("users").findOne({ email });
    if (!user || user.password !== password) return res.status(400).json({ message: "Invalid Credentials" });

    const token = jwt.sign({ id: user._id, role: user.role, email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1d" });
    res.json({ message: "Login Success", token });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

// ---------------------------
// Assets CRUD
app.post("/assets", verifyJWT, verifyHR, async (req, res) => {
  try {
    const { productName, productImage, productType, productQuantity } = req.body;
    const hr = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });
    if (!hr) return res.status(400).json({ message: "HR not found" });

    const asset = {
      productName,
      productImage,
      productType,
      productQuantity,
      availableQuantity: productQuantity,
      hrEmail: hr.email,
      companyName: hr.companyName,
      dateAdded: new Date()
    };

    const result = await db.collection("assets").insertOne(asset);
    res.status(201).json({ message: "Asset Created", asset });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

app.get("/assets", verifyJWT, async (req, res) => {
  try {
    const assets = await db.collection("assets").find().toArray();
    res.json(assets);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

app.patch("/assets/:id", verifyJWT, verifyHR, async (req, res) => {
  try {
    const assetId = req.params.id;
    const updateData = req.body;
    const result = await db.collection("assets").updateOne(
      { _id: new ObjectId(assetId) },
      { $set: updateData }
    );
    res.json(result);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

app.delete("/assets/:id", verifyJWT, verifyHR, async (req, res) => {
  try {
    const assetId = req.params.id;
    const result = await db.collection("assets").deleteOne({ _id: new ObjectId(assetId) });
    res.json(result);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

// ---------------------------
// Employee Requests
app.post("/requests", verifyJWT, async (req, res) => {
  try {
    const { assetId, note } = req.body;
    const asset = await db.collection("assets").findOne({ _id: new ObjectId(assetId) });
    if (!asset) return res.status(404).json({ message: "Asset not found" });

    const reqExists = await db.collection("requests").findOne({
      assetId: new ObjectId(assetId),
      requesterEmail: req.user.email,
      requestStatus: "pending"
    });
    if (reqExists) return res.status(400).json({ message: "Request already pending" });

    const request = {
      assetId: asset._id,
      assetName: asset.productName,
      assetType: asset.productType,
      requesterName: req.user.email,
      requesterEmail: req.user.email,
      hrEmail: asset.hrEmail,
      companyName: asset.companyName,
      note,
      requestDate: new Date(),
      requestStatus: "pending"
    };

    const result = await db.collection("requests").insertOne(request);
    res.status(201).json({ message: "Request Sent", request });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

// HR Approves/Rejects Request
app.post("/requests/:id/approve", verifyJWT, verifyHR, async (req, res) => {
  try {
    const request = await db.collection("requests").findOne({ _id: new ObjectId(req.params.id) });
    if (!request) return res.status(404).json({ message: "Request not found" });
    if (request.requestStatus !== "pending") return res.status(400).json({ message: "Already processed" });

    const asset = await db.collection("assets").findOne({ _id: request.assetId });
    if (!asset || asset.availableQuantity <= 0) return res.status(400).json({ message: "No stock available" });

    const assigned = {
      assetId: asset._id,
      assetName: asset.productName,
      assetImage: asset.productImage,
      assetType: asset.productType,
      employeeEmail: request.requesterEmail,
      employeeName: request.requesterName,
      hrEmail: asset.hrEmail,
      companyName: asset.companyName,
      assignmentDate: new Date(),
      status: "assigned"
    };

    await db.collection("assignedAssets").insertOne(assigned);
    await db.collection("assets").updateOne({ _id: asset._id }, { $inc: { availableQuantity: -1 } });
    await db.collection("requests").updateOne({ _id: request._id }, { $set: { requestStatus: "approved", approvalDate: new Date(), processedBy: req.user.email } });

    res.json({ message: "Request Approved", assigned });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Approve failed" });
  }
});

app.patch("/requests/:id/reject", verifyJWT, verifyHR, async (req, res) => {
  try {
    const id = req.params.id;
    await db.collection("requests").updateOne({ _id: new ObjectId(id) }, { $set: { requestStatus: "rejected", processedBy: req.user.email, approvalDate: new Date() } });
    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Reject failed" });
  }
});

// ---------------------------
// Packages
app.get("/packages", async (req, res) => {
  try {
    const packages = await db.collection("packages").find().toArray();
    res.json(packages);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

/// 
app.get("/packages/hr", async (req, res) => {
  try {
    const packages = await db.collection("packages").find().toArray();
    res.json(packages);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch packages" });
  }
});

////////////////////////////////////////////////////
// 
const seedPackages = async () => {
  const count = await db.collection("packages").countDocuments();
  if (count === 0) {
    const samplePackages = [
      { name: "Basic", employeeLimit: 5, price: 5, features: ["5 Employees", "Basic Tracking"] },
      { name: "Pro", employeeLimit: 10, price: 10, features: ["10 Employees", "Priority Support"] },
      { name: "Enterprise", employeeLimit: 15, price: 15, features: ["15 Employees", "All Access"] },
    ];
    await db.collection("packages").insertMany(samplePackages);
    console.log("Sample packages seeded!");
  }
};
// db connection er pore seedPackages() call korben

// ---------------------------

// Stripe Checkout Session (SECURE VERSION)
app.post("/create-checkout-session", verifyJWT, async (req, res) => {
  try {
    const { packageId } = req.body;

    if (!packageId) {
      return res.status(400).json({ message: "Package ID required" });
    }

    const userEmail = req.user.email;

    const user = await db.collection("users").findOne({ email: userEmail });
    if (!user) return res.status(404).json({ message: "User not found" });

    const pkg = await db
      .collection("packages")
      .findOne({ _id: new ObjectId(packageId) });

    if (!pkg) return res.status(404).json({ message: "Package not found" });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: pkg.name,
              description: `Employee Limit: ${pkg.employeeLimit}`,
            },
            unit_amount: pkg.price * 100,
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: user._id.toString(),
        packageId: pkg._id.toString(),
      },
      success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_DOMAIN}/payment-cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe Error:", err);
    res.status(500).json({ message: "Stripe session creation failed" });
  }
});

app.post("/payment-success", async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: "Session ID required" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const { userId, packageId } = session.metadata;

    const pkg = await db
      .collection("packages")
      .findOne({ _id: new ObjectId(packageId) });

    if (!pkg) return res.status(404).json({ message: "Package not found" });

    // ✅ Update user
    await db.collection("users").updateOne(
      { _id: new ObjectId(userId) },
      {
        $set: {
          packageName: pkg.name,
          packageLimit: pkg.employeeLimit,
          subscription: "active",
          updatedAt: new Date(),
        },
      }
    );

    // ✅ Save payment
    await db.collection("payments").insertOne({
      userId: new ObjectId(userId),
      packageName: pkg.name,
      employeeLimit: pkg.employeeLimit,
      amount: pkg.price,
      transactionId: session.id,
      paymentDate: new Date(),
      status: "completed",
    });

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Payment update failed" });
  }
});



//payment success 
// server.js
app.patch("/payment-success", async (req, res) => {
  const { sessionId } = req.body;
  try {
    // ১. Stripe থেকে সেশন ডিটেইলস আনা
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status === "paid") {
      const email = session.customer_details.email;
      
      const result = await db.collection("users").updateOne(
        { email: email },
        { $set: { isSubscribed: true, employeeLimit: session.metadata.limit } }
      );
      
      res.send({ success: true, message: "Plan updated successfully!" });
    }
  } catch (error) {
    res.status(500).send({ success: false, message: "Server error" });
  }
});


// ---------------------------
// User info & role
app.get("/users/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const user = await db.collection("users").findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

app.get("/users/:email/role", async (req, res) => {
  try {
    const user = await db.collection("users").findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ role: null });
    res.json({ role: user.role });
  } catch (err) {
    console.log(err);
    res.status(500).json({ role: null });
  }
});

// ---------------------------
app.post("/jwt", async (req, res) => {
  try {
    const { email, name, photo } = req.body;
    if (!email) return res.status(400).json({ message: "Email required" });

    // ১. ইউজারকে খোঁজা
    let user = await db.collection("users").findOne({ email });

    // ২. যদি ইউজার না থাকে (যেমন নতুন গুগল লগইন বা রেজিস্ট্রেশনের সাথে সাথে কল হলে)
    if (!user) {
      const newUser = {
        email,
        name: name || "New User",
        photo: photo || "",
        role: "employee", 
        createdAt: new Date(),
      };
      const result = await db.collection("users").insertOne(newUser);
      user = { ...newUser, _id: result.insertedId };
    }

    
    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token });
  } catch (err) {
    console.log("JWT Error:", err);
    res.status(500).json({ message: "JWT Error" });
  }
});

// ---------------------------
// Start Server
// app.listen(process.env.PORT, () => console.log(`🚀 Server running on ${process.env.PORT}`));

app.get("/asset-requests/hr", verifyJWT, verifyHR, async (req, res) => {
  try {
    const hrEmail = req.user.email; 
    const requests = await db
      .collection("requests")
      .find({ hrEmail })
      .sort({ requestDate: -1 })
      .toArray();
    res.json(requests);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

app.delete("/requests/:id", verifyJWT, verifyHR, async (req, res) => {
  try {
    const id = req.params.id;
    const result = await db.collection("requests").deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server Error" });
  }
});

// -------------------------
// 1️⃣ Employee: Get public assets
app.get("/assets/public", async (req, res) => {
  try {
    const searchText = req.query.searchText || "";
    const limit = parseInt(req.query.limit) || 10;
    const skip = parseInt(req.query.skip) || 0;

    const query = { productName: { $regex: searchText, $options: "i" } };
    const total = await db.collection("assets").countDocuments(query);
    const assets = await db.collection("assets")
      .find(query)
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({ assets, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
});

// -------------------------
// 2️⃣ Employee: Request an asset
app.post("/requests", verifyJWT, async (req, res) => {
  try {
    const { assetId } = req.body;
    if (!assetId) return res.status(400).json({ message: "Asset ID required" });

    const asset = await db.collection("assets").findOne({ _id: new ObjectId(assetId) });
    if (!asset) return res.status(404).json({ message: "Asset not found" });

    // Check if already requested and pending
    const exists = await db.collection("requests").findOne({
      assetId: asset._id,
      requesterEmail: req.user.email,
      requestStatus: "pending"
    });
    if (exists) return res.status(400).json({ message: "Request already pending" });

    const request = {
      assetId: asset._id,
      assetName: asset.productName,
      assetImage: asset.productImage,
      assetType: asset.productType,
      requesterEmail: req.user.email,
      requesterName: req.user.name,
      hrEmail: asset.hrEmail,
      companyName: asset.companyName,
      requestDate: new Date(),
      requestStatus: "pending"
    };

    await db.collection("requests").insertOne(request);
    res.status(201).json({ message: "Request sent", request });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Request failed" });
  }
});

// -------------------------
// 3️⃣ Employee: Get My Assets (approved requests)
app.get("/asset-requests/employee", verifyJWT, async (req, res) => {
  try {
    const email = req.user.email;

    // Fetch approved requests / assigned assets
    const requests = await db.collection("requests")
      .find({ requesterEmail: email })
      .sort({ requestDate: -1 })
      .toArray();

    res.json(requests);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server Error" });
  }
});


app.post('/users', async (req, res) => {
  try {
    const user = req.body;
    const query = { email: user.email };
    

    const existingUser = await db.collection("users").findOne(query);
    if (existingUser) {
      return res.send({ message: 'user already exists', insertedId: null });
    }

    const result = await db.collection("users").insertOne(user);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

//  সিঙ্গেল ইউজার খোঁজার রাউট (NavBar ও useRole এর জন্য)
app.get('/users/:email', async (req, res) => {
  try {
    const email = req.params.email;
    const result = await db.collection("users").findOne({ email });
    if (result) {
      res.send(result);
    } else {
      res.status(404).send({ message: "User not found" });
    }
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

// ইউজারের রোল দেখার রাউট (useRole এর জন্য)
app.get('/users/:email/role', async (req, res) => {
  try {
    const email = req.params.email;
    const user = await db.collection("users").findOne({ email });
    res.send({ role: user?.role || 'employee' });
  } catch (error) {
    res.status(500).send({ role: null });
  }
}); 

// ১. সকল এমপ্লয়ি গেট করার রাউট
app.get('/employees', async (req, res) => {
    try {
  const query = { role: "employee" }; 
        const result = await userCollection.find(query).toArray();
        res.send(result);
    } catch (error) {
        console.error("Error fetching employees:", error);
        res.status(500).send({ message: "Internal server error" });
    }
});

// ২. এমপ্লয়ি রিমুভ (Delete) করার রাউট
app.delete('/employees/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await userCollection.deleteOne(query);
        
        if (result.deletedCount > 0) {
            res.send(result);
        } else {
            res.status(404).send({ message: "Employee not found" });
        }
    } catch (error) {
        console.error("Error deleting employee:", error);
        res.status(500).send({ message: "Failed to delete" });
    }
});
module.exports = app;
