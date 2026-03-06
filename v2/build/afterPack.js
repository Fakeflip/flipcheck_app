// afterPack.js — strips macOS extended attributes (resource forks / Finder info)
// from the packaged app before codesign runs. Prevents:
//   "resource fork, Finder information, or similar detritus not allowed"
const { execSync } = require("child_process");

exports.default = async ({ appOutDir }) => {
  if (process.platform !== "darwin") return;
  try {
    execSync(`xattr -cr "${appOutDir}"`, { stdio: "pipe" });
    console.log(`  • stripped xattrs  dir=${appOutDir}`);
  } catch (e) {
    console.warn("  ⚠ xattr strip failed:", e.message);
  }
};
