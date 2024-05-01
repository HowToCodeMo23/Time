import express from "express"; // Importiere das Express-Framework
import bodyParser from "body-parser"; // Middleware zum Parsen von URL-codierten Daten
import pg from "pg"; // PostgreSQL-Datenbanktreiber
import session from "express-session"; // Middleware für Sitzungsverwaltung
import argon2 from "argon2"; // Bibliothek für Passwort-Hashing
import fs from "fs"; //Bibliothek für FileSystem
import path from "path"; //Bibliotek für Pfadmanagement

// Initialisiere die Express-App
const app = express();
const port = 3000;

// Konfiguriere die Sitzungsmiddleware
app.use(
  session({
    secret: "penispumpe", // Geheimer Schlüssel zur Sitzungsverschlüsselung
    resave: false, // Deaktiviere das Speichern von Sitzungsdaten, wenn keine Änderungen vorgenommen wurden
    saveUninitialized: true, // Speichere neue Sitzungen, die nicht modifiziert wurden
    cookie: {
      secure: false, // Erlaube Cookies über nicht-HTTPS-Verbindungen
      path: "/", // Erlaube das Teilen von Cookies über die gesamte App
    },
  }),
);

// Erstelle einen PostgreSQL-Datenbankverbindungspool
const db = new pg.Pool({
  user: "postgres", // Benutzername der Datenbank
  host: "localhost", // Host der Datenbank
  database: "Project", // Name der Datenbank
  password: "adminadmin", // Passwort der Datenbank
  max: 10, // Maximale Anzahl von Clients im Pool
  port: 5432, // Datenbankport
});

//db.connect(); // Verbinde mit der PostgreSQL-Datenbank

// Middleware zum Parsen von URL-codierten Daten
app.use(bodyParser.urlencoded({ extended: true }));
// Middleware zum Bereitstellen statischer Dateien aus dem Verzeichnis 'public'
app.use(express.static("public"));

// Stammroute
app.get("/", (req, res) => {
  console.log(req.session);
  if (!req.session.user) {
    res.render("index.ejs", { error: req.query.error });
  } else {
    res.redirect("/dashboard");
  }
});

// Login-Route
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  req.session.user = { username: "cool", password: "sad" };
  return res.redirect("/dashboard");

  const result = await db.query("SELECT * FROM Employee WHERE username = $1", [
    username.trim(),
  ]);

  if (result.rows.length > 0) {
    const user = result.rows[0];
    if (
      user.username === "testadmin" &&
      (await argon2.verify(user.passwort, password))
    ) {
      req.session.user = user;
      res.render("admin.ejs");
      return;
    } else if (await argon2.verify(user.passwort, password)) {
      req.session.user = user;
      res.redirect("/dashboard");
      return;
    }
  }

  res.redirect("/?error=1");
});

// Admin-Route
app.get("/admin", (req, res) => {
  if (req.session.user == "admin") {
    res.render("admin.ejs");
  } else {
    res.redirect("/");
  }
});

// Login-Route
app.get("/login", (req, res) => {
  res.render("/");
});

// Dashboard-Route
app.get("/dashboard", async (req, res) => {
  if (req.session.user) {
    try {
      // Projekte aus der Datenbank abrufen
      //const result = await db.query("SELECT * FROM projects");
      const projects = [];

      // Dashboard-Seite rendern und Projekte übergeben
      res.render("dashboard.ejs", { projects });
    } catch (error) {
      console.error(
        "Fehler beim Abrufen der Projekte aus der Datenbank:",
        error,
      );
      res.status(500).send("Interner Serverfehler");
    }
  } else {
    res.redirect("/");
  }
});

// Zeit-Erfassungs-Route
app.post("/time", async (req, res) => {
  const startTime = req.body["time1"];
  const endTime = req.body["time2"];
  const EID = parseInt(req.session.user.personalid);
  const PID = parseInt(req.body["Projekte"]);

  try {
    const result = await db.query(
      "INSERT INTO times (startzeit, endzeit, last_updated, p_id, e_id) VALUES ($1, $2, CURRENT_DATE, $3, $4)",
      [startTime, endTime, PID, EID],
    );

    console.log("Insert-Ergebnis:", result);

    if (result.rowCount > 0) {
      res.redirect("/dashboard");
    } else {
      console.error("Keine Zeilen eingefügt.");
      res.redirect("/dashboard");
    }
  } catch (error) {
    console.error("Fehler beim Einfügen der Daten:", error);
    res.status(500).send("Interner Serverfehler");
  }
});

function convertToCSV(data) {
  const header = Object.keys(data[0]).join(",") + "\n";
  const rows = data.map((obj) => Object.values(obj).join(",")).join("\n");
  return header + rows;
}

app.get("/export", async (req, res) => {
  // Überprüfe, ob der Benutzer angemeldet ist
  if (req.session.user) {
    const result = await db.query(
      "SELECT employee.personalid, employee.username, times.startzeit, times.endzeit, times.last_updated,times.p_id, projects.projectname FROM TIMES INNER JOIN employee ON employee.personalid = times.e_id INNER JOIN projects ON projects.projectid = times.p_id",
    );
    const data = result.rows;

    // Konvertiere die Daten in CSV-Format
    const csvContent = convertToCSV(data);

    // Setze die Header für den Dateidownload
    res.setHeader("Content-Disposition", "attachment; filename=export.csv");
    res.setHeader("Content-Type", "text/csv");

    // Sende die CSV-Daten an den Client
    res.send(csvContent);
  } else {
    res.redirect("/");
  }
});

app.get("/download", (req, res) => {
  // Absoluten Pfad zur temporären CSV-Datei angeben
  const filePath = path.join(__dirname, "temp.csv");

  // Lese die temporäre CSV-Datei
  const file = fs.createReadStream(filePath);

  // Setze die Header für den Dateidownload
  res.setHeader("Content-Disposition", "attachment; filename=export.csv");
  res.setHeader("Content-Type", "text/csv");

  // Übertrage den Inhalt der Datei an den Client
  file.pipe(res);

  // Nach dem Pipe-Vorgang die temporäre CSV-Datei löschen
  file.on("end", () => {
    fs.unlinkSync(filePath);
  });
});

// Logout-Route
app.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Fehler beim Löschen der Sitzung:", err);
      return res.status(500).send("Interner Serverfehler");
    }
    res.setHeader("Cache-Control", "no-store");
    res.redirect("/");
  });
});

// Kalender-Route
app.get("/calendar", (req, res) => {
  if (req.session.user) {
    res.render("calendar.ejs");
  } else {
    res.redirect("/");
  }
});

// Starte den Server
app.listen(port, () => {
  console.log(`Server läuft auf http://localhost:${port}`);
});
