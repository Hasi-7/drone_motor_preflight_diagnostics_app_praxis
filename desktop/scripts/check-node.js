const major = Number.parseInt(process.versions.node.split(".")[0], 10);

if (!Number.isFinite(major) || major < 20 || major >= 24) {
  console.error(
    [
      "Unsupported Node.js version for desktop/.",
      `Detected: ${process.versions.node}`,
      "Use Node 20.x or 22.x before running npm install.",
      "This avoids native module build failures for better-sqlite3 on Windows.",
    ].join("\n"),
  );
  process.exit(1);
}
