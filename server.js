require("dotenv").config(); // 👈 load env vars

const express = require("express");
const path = require("path");
const multer = require("multer");
const mysql = require("mysql2");
const session = require("express-session");
const fs = require("fs");

const app = express();
const port = process.env.PORT || 3000; // from .env

// --- DB Connection ---
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});


db.connect((err) => {
  if (err) console.error("MySQL error:", err);
  else console.log("✅ Connected to MySQL");
});

// --- Middleware ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "public/uploads")));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
}));


// --- Multer setup ---
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadPath = path.join(__dirname, "public/uploads");
      if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath);
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const name = Date.now() + "-" + Math.round(Math.random() * 1e9) + ext;
      cb(null, name);
    },
  }),
});

// --- Pages ---
const page = (file) => path.join(__dirname, "views", file);
app.get("/", (req, res) => res.sendFile(page("index.html")));
app.get("/auth", (req, res) => res.sendFile(page("auth.html")));
app.get("/gender", (req, res) => req.session.email ? res.sendFile(page("gender.html")) : res.redirect("/auth"));
app.get("/profile", (req, res) => req.session.email ? res.sendFile(page("profile.html")) : res.redirect("/auth"));
app.get("/vote", (req, res) => req.session.email ? res.sendFile(page("vote.html")) : res.redirect("/auth"));

// --- Auth ---
app.post("/signup", (req, res) => {
  const { email, password } = req.body;
  db.query("INSERT INTO users (email, password) VALUES (?, ?)", [email, password], (err) => {
    if (err) return res.send("Signup failed.");
    req.session.email = email;
    res.redirect("/gender");
  });
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.query("SELECT * FROM users WHERE email = ?", [email], (err, results) => {
    if (err || results.length === 0 || results[0].password !== password)
      return res.send("Invalid Login. Please check your credentials.");
    req.session.email = email;
    res.redirect("/vote");
  });
});

// --- Gender ---
app.post("/set-gender", (req, res) => {
  const email = req.session.email;
  const { gender } = req.body;
  if (!email) return res.redirect("/auth");

  db.query("UPDATE users SET gender = ? WHERE email = ?", [gender, email], (err) => {
    if (err) return res.send("Failed to save gender.");
    res.redirect("/profile");
  });
});

// --- Profile ---
app.post("/set-profile", upload.single("photopath"), (req, res) => {
  const email = req.session.email;
  const { username, college, interest, instagram } = req.body;
  const photoPath = req.file ? `/uploads/${req.file.filename}` : null;

  db.query("UPDATE users SET username = ?, college = ?, interest = ?, instagram = ?, photo = ? WHERE email = ?",
  [username, college, interest, instagram, photoPath, email], (err) => {
    if (err) return res.send("Profile update failed.");
    res.redirect("/vote");
    console.log(`Profile Created Successfully for ${email}`);
  });

});

// --- Voting ---
app.post("/vote", (req, res) => {
  const email = req.session.email;
  const votedProfileId = req.body.profileId;
  const side = req.body.side; // "top" or "bottom"
  const topId = req.body.topId;
  const bottomId = req.body.bottomId;

  if (!email) {
    return res.status(401).send({ error: "Not logged in" });
  }

  db.query("SELECT * FROM users WHERE email = ?", [email], (err, userResult) => {
    if (err || userResult.length === 0) {
      return res.status(500).send({ error: "User not found" });
    }

    const user = userResult[0];
    const userId = user.id;
    const gender = (user.gender || "").toLowerCase().trim();
    const oppositeGender = gender === "male" ? "female" : "male";


    // If no vote, send two profiles (initial load)
    if (!votedProfileId) {
      db.query(
        `SELECT id, username, college, interest, instagram, photo FROM users 
         WHERE gender = ? AND id != ? ORDER BY RAND() LIMIT 2`,
        [oppositeGender, userId],
        (err2, profiles) => {
          if (err2 || profiles.length < 2) {
            return res.status(200).send({ message: "Not enough profiles found." });
          }
          return res.send({ profiles });
        }
      );
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    db.query(
      `SELECT COUNT(*) AS count FROM votes 
       WHERE voter_id = ? AND DATE(timestamp) = ?`,
      [userId, today],
      (err3, countResult) => {
        if (err3) return res.status(500).send({ error: "Vote count check failed" });

        const voteCount = countResult[0].count;
        if (voteCount >= 50) {
          return res.status(403).send({ message: "Vote limit reached for today. Limit will be reset at midnight. THANKYOU!" });
        }

        db.query(
          `INSERT INTO votes (voter_id, voted_profile_id, timestamp) VALUES (?, ?, NOW())`,
          [userId, votedProfileId],
          (err4) => {
            if (err4) return res.status(500).send({ error: "Vote saving failed" });

            // Get new profile, excluding both shown profiles
            const excludeIds = [votedProfileId];
            if (side === 'top' && bottomId) excludeIds.push(bottomId);
            if (side === 'bottom' && topId) excludeIds.push(topId);

            db.query(
              `SELECT id, username, college, interest, instagram, photo FROM users 
               WHERE gender = ? AND id NOT IN (?) ORDER BY RAND() LIMIT 1`,
              [oppositeGender, excludeIds],
              (err5, newProfileResult) => {
                if (err5 || newProfileResult.length === 0) {
                  return res.status(200).send({ message: "Voted, but no more profiles" });
                }

                return res.send({
                  replace: side === "top" ? "bottom" : "top",
                  profile: newProfileResult[0],
                });
              }
            );
          }
        );
      }
    );
  });
});

// ✅ POST: Save updated profile data
app.get("/update-profile", (req, res) => {
  if (!req.session.email) return res.redirect("/login"); // Optional check
  res.sendFile(path.join(__dirname, "views", "update-profile.html"));
});

app.get("/get-profile-data", (req, res) => {
  const email = req.session.email;
  if (!email) return res.json({ success: false });

  db.query("SELECT username, college, interest, instagram, photo FROM users WHERE email = ?", [email], (err, result) => {
    if (err || result.length === 0) return res.json({ success: false });

    res.json({ success: true, profile: result[0] });
  });
});

app.post("/update-profile", upload.single("photopath"), (req, res) => {
  const email = req.session.email;
  if (!email) return res.status(401).send("Not logged in");

  const { username, college, interest, instagram } = req.body;
  const photoPath = req.file ? `/uploads/${req.file.filename}` : null;

  const sql = photoPath
    ? "UPDATE users SET username = ?, college = ?, interest = ?, instagram = ?, photo = ? WHERE email = ?"
    : "UPDATE users SET username = ?, college = ?, interest = ?, instagram = ? WHERE email = ?";

  const params = photoPath
    ? [username, college, interest, instagram, photoPath, email]
    : [username, college, interest, instagram, email];

  db.query(sql, params, (err) => {
    if (err) {
      console.log("Error updating profile:", err);
      return res.status(500).send("Profile update failed");
    }

    res.redirect("/vote"); // or wherever
  });
});


app.get("/battleboard-data", (req, res) => {
  const gender = req.query.gender;
  if (!["male", "female"].includes(gender)) {
    return res.status(400).json({ success: false, message: "Invalid gender" });
  }

  const sql = `
    SELECT u.username, u.college, u.photo, COUNT(v.id) AS votes
    FROM users u
    JOIN votes v ON u.id = v.voted_profile_id
    WHERE 
      u.gender = ? AND 
      WEEK(v.timestamp, 1) = WEEK(NOW(), 1) AND
      YEAR(v.timestamp) = YEAR(NOW())
    GROUP BY u.id
    ORDER BY votes DESC
    LIMIT 10
  `;

  db.query(sql, [gender], (err, results) => {
    if (err) {
      console.error("BattleBoard query error:", err);
      return res.status(500).json({ success: false, message: "Server error" });
    }

    res.json({ success: true, data: results });
  });
});

app.get("/battleboard", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "battleboard.html"));
});

app.get("/feedback", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "feedback.html"));
});


app.get("/logout", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "logout.html"));
});

app.get("/about", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "about.html"));
});

app.get("/updates", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "updates.html"));
});


// Start server
const PORT = 3306 || process.env.PORT || 3306;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});