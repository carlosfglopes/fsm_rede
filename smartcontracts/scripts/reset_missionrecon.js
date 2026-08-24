// scripts/reset_missionrecon.js
// Calls resetMission() on the deployed MissionRecon contract, returning it to IDLE.
//
// Usage:
//   npx hardhat run scripts/reset_missionrecon.js --network rede_uav
//

const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

const GAS = {
  gasLimit            : 3000000,
  maxFeePerGas        : 2000000000,
  maxPriorityFeePerGas: 1000000000,
};

function missionStateLabel(value) {
  const labels = {
    0: "IDLE", 1: "ACTIVE", 2: "ELECTION", 3: "ASSIGNED",
    4: "REPORTING", 5: "COMPLETED", 6: "FAILED", 7: "TERMINATED",
  };
  return labels[Number(value)] ?? `UNKNOWN(${value})`;
}

function sep(label) {
  console.log(`\n${"─".repeat(50)}`);
  if (label) console.log(`  ${label}`);
  console.log("─".repeat(50));
}

async function getContract(authority) {
  const MissionRecon = await hre.ethers.getContractFactory("MissionRecon");

  if (process.env.MISSION_ADDRESS) {
    console.log("  Attach via MISSION_ADDRESS:", process.env.MISSION_ADDRESS);
    return MissionRecon.attach(process.env.MISSION_ADDRESS);
  }

  const jsonPath = path.join(__dirname, "..", "deployed_mrecon.json");
  if (fs.existsSync(jsonPath)) {
    const info = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    if (info.network === hre.network.name) {
      console.log("  Attach via deployed_mrecon.json:", info.address);
      return MissionRecon.attach(info.address);
    }
    throw new Error(`deployed_mrecon.json is for network "${info.network}", but you are on "${hre.network.name}"`);
  }

  throw new Error(
    "No contract found.\n" +
    "Set MISSION_ADDRESS or make sure deployed_mrecon.json exists."
  );
}

async function main() {
  const [authority] = await hre.ethers.getSigners();

  sep("MissionRecon — Mission Reset");
  console.log("  Network   :", hre.network.name);
  console.log("  Authority :", authority.address);

  const mission = await getContract(authority);

  const stateBefore = await mission.missionState();
  console.log("\n  Current state:", missionStateLabel(stateBefore));

  if (Number(stateBefore) === 0) {
    console.error("\n  ✘ The contract is already IDLE — nothing to reset.");
    process.exitCode = 1;
    return;
  }

  console.log("\n  Calling resetMission()...");
  const tx      = await mission.connect(authority).resetMission(GAS);
  const receipt = await tx.wait();

console.log(
  `  ✔ Reset complete | gas: ${receipt.gasUsed.toString()} | block: ${
    receipt.blockNumber
  }`,
);

const stateAfter = await mission.missionState();
console.log("\n  ── State after reset ────────────────");
console.log("  State           :", missionStateLabel(stateAfter));

try {
  const permCount = await mission.getPermittedUAVCount();
  const regCount = await mission.getRegisteredUAVCount();
  console.log("  Permitted UAVs  :", permCount.toString());
  console.log("  Registered UAVs :", regCount.toString());
} catch {
  console.log(
    "  (counters unavailable in IDLE state — normal after reset)",
  );
}

  if (Number(stateAfter) === 0) {
    console.log("\n  Contract ready for a new mission.");
    console.log("    You can run: npx hardhat run scripts/simulate_mission1.js --network rede_uav");
  } else {
    console.error("  ✘ Unexpected state after reset:", missionStateLabel(stateAfter));
    process.exitCode = 1;
  }

  sep("END");
}

main().catch((err) => {
  console.error("✘ Error:", err.message);
  process.exitCode = 1;
});