// Kept as the entry of `prisma db seed` and ops/run.sh; the ver1 seed is prisma/seed.ts.
require("node:child_process").execFileSync(process.execPath, ["bin/run-ts.mjs", "prisma/seed.ts"], {
  cwd: require("node:path").join(__dirname, ".."),
  stdio: "inherit",
});
