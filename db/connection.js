/**
 * MongoDB connection.
 *
 * The connection string lives in the MONGO_URI environment variable, never
 * in this file - it contains a username and password, and anything written
 * here would end up in git history.
 *
 * Set it before running the pipeline, e.g.
 *   PowerShell:  $env:MONGO_URI = "mongodb+srv://user:pass@host/skeo"
 *   bash:        export MONGO_URI="mongodb+srv://user:pass@host/skeo"
 */

"use strict";

const mongoose = require("mongoose");

/**
 * Read a local .env if one exists, so running the pipeline by hand doesn't
 * mean pasting a connection string into the shell every time.
 *
 * Node's own loader, not the dotenv package - it needs no dependency, and
 * this repo deliberately has almost none. It throws when there is no file,
 * which is the normal case in CI where the value comes from a GitHub secret,
 * so the failure is swallowed rather than handled.
 *
 * Real environment variables always win: a .env is a convenience for a
 * laptop, never a way to override what CI passed in.
 */
function loadDotEnv() {
  const preset = process.env.MONGO_URI;
  try {
    if (typeof process.loadEnvFile === "function") process.loadEnvFile();
  } catch {
    // No .env file. Expected in CI.
  }
  if (preset) process.env.MONGO_URI = preset;
}

loadDotEnv();

let connectionPromise = null;

/**
 * Opens the connection, or reuses it if one is already open. Mongoose keeps
 * a pool of sockets internally, so calling connect() repeatedly would waste
 * connections rather than speed anything up.
 */
function connectToMongo() {
  if (connectionPromise) return connectionPromise;

  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error(
      "MONGO_URI is not set. Export your MongoDB connection string before running the pipeline."
    );
  }

  connectionPromise = mongoose.connect(uri);
  return connectionPromise;
}

async function disconnectFromMongo() {
  if (!connectionPromise) return;

  await mongoose.disconnect();
  connectionPromise = null;
}

module.exports = { connectToMongo, disconnectFromMongo };
