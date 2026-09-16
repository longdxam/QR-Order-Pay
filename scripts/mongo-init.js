// Init replica set if not yet initialized.
// Mongo Docker entrypoint runs every JS file in /docker-entrypoint-initdb.d once on first start.
// We cannot rely on `mongosh` here because it may not be present in older images; instead use the
// admin database and rs.initiate via the mongo shell command line through `mongosh --eval`.
try {
  rs.status();
} catch (e) {
  try {
    rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] });
  } catch (e2) {
    print("replica set init skipped:", e2.message);
  }
}
