// scripts/reset_missionfail.js
// Calls resetMission() on the deployed MissionFail contract, returning it to SETUP.
//
// Usage:
//   npx hardhat run scripts/reset_missionfail.js --network rede_uav

const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

const GAS = {
  gasLimit            : 3000000,
  maxFeePerGas        : 2000000000,
  maxPriorityFeePerGas: 1000000000,
};

function missionStateLabel(v) {
  const l = { 0:"SETUP", 1:"ACTIVE", 2:"UNDER_CONFIRMATION", 3:"RECONFIGURING",
              4:"ACTIVE_RECONFIGURED", 5:"DEGRADED", 6:"ABORTED" };
  return l[Number(v)] ?? `UNKNOWN(${v})`;
}

function sep(label) {
  console.log(`\n${"─".repeat(50)}`);
  if (label) console.log(`  ${label}`);
  console.log("─".repeat(50));
}

async function main() {
  const [authority] = await hre.ethers.getSigners();

  sep("MissionFail — Mission Reset");
  console.log("  Network   :", hre.network.name);
  console.log("  Authority :", authority.address);

  const MissionFail = await hre.ethers.getContractFactory("MissionFail");

  let mission;
  if (process.env.MISSION_ADDRESS) {
    console.log("  Attach via MISSION_ADDRESS:", process.env.MISSION_ADDRESS);
    mission = MissionFail.attach(process.env.MISSION_ADDRESS);
  } else {
    const jsonPath = path.join(__dirname, "..", "deployed_mfail.json");
    if (!fs.existsSync(jsonPath)) {
      throw new Error("deployed_mfail.json not found. Deploy first.");
    }
    const info = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    if (info.network !== hre.network.name) {
      throw new Error(`deployed_mfail.json is for "${info.network}", but you are on "${hre.network.name}"`);
    }
    console.log("  Attach via deployed_mfail.json:", info.address);
    mission = MissionFail.attach(info.address);
  }

  const stateBefore = await mission.missionState();
  console.log("\n  Current state:", missionStateLabel(stateBefore));

  if (Number(stateBefore) === 0) {
    console.error("\n  ✘ The contract is already in SETUP — nothing to reset.");
    process.exitCode = 1;
    return;
  }

  console.log("\n  Calling resetMission()...");
  const tx      = await mission.connect(authority).resetMission(GAS);
  const receipt = await tx.wait();
  console.log(`  ✔ Reset complete | gas: ${receipt.gasUsed.toString()} | block: ${receipt.blockNumber}`);

  const stateAfter  = await mission.missionState();
  const uavCount    = await mission.getUAVCount();
  const taskCount   = await mission.getActiveTaskCount();
  const failCount   = await mission.failureCount();

  console.log("\n  ── State after reset ────────────────────");
  console.log("  State        :", missionStateLabel(stateAfter));
  console.log("  UAVs         :", uavCount.toString());
  console.log("  Tasks        :", taskCount.toString());
  console.log("  failureCount :", failCount.toString());

  if (Number(stateAfter) === 0) {
    console.log("\n  ✔ Contract ready for a new simulation.");
    console.log("    You can run: npx hardhat run scripts/simulate_mission2.js --network rede_uav");
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
