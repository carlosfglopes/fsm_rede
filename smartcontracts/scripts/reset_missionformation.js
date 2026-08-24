// scripts/reset_missionformation.js
// Calls resetMission() on the deployed MissionFormation contract, returning it to SETUP.
//
// Usage:
//   npx hardhat run scripts/reset_missionformation.js --network rede_uav

const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

const GAS = {
  gasLimit            : 3000000,
  maxFeePerGas        : 2000000000,
  maxPriorityFeePerGas: 1000000000,
};

function missionStateLabel(v) {
  const l = {
    0: "SETUP",
    1: "ACTIVE",
    2: "RECONFIGURING_FORMATION",
    3: "DEGRADED",
    4: "COMPLETED",
    5: "ABORTED",
  };
  return l[Number(v)] ?? `UNKNOWN(${v})`;
}

function uavStateLabel(v) {
  return ["OK", "LATE", "OUT_OF_FORMATION", "INACTIVE"][Number(v)] ?? `UNKNOWN(${v})`;
}

function sep(label) {
  console.log(`\n${"─".repeat(50)}`);
  if (label) console.log(`  ${label}`);
  console.log("─".repeat(50));
}

async function main() {
  const [authority] = await hre.ethers.getSigners();

  sep("MissionFormation — Mission Reset");
  console.log("  Network   :", hre.network.name);
  console.log("  Authority :", authority.address);

  const MissionFormation = await hre.ethers.getContractFactory("MissionFormation");

  let mission;
  if (process.env.MISSION_ADDRESS) {
    console.log("  Attach via MISSION_ADDRESS:", process.env.MISSION_ADDRESS);
    mission = MissionFormation.attach(process.env.MISSION_ADDRESS);
  } else {
    const jsonPath = path.join(__dirname, "..", "deployed_mformation.json");
    if (!fs.existsSync(jsonPath)) {
      throw new Error("deployed_mformation.json not found. Deploy first.");
    }
    const info = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    if (info.network !== hre.network.name) {
      throw new Error(
        `deployed_mformation.json is for "${info.network}", but you are on "${hre.network.name}"`
      );
    }
    console.log("  Attach via deployed_mformation.json:", info.address);
    mission = MissionFormation.attach(info.address);
  }

  const stateBefore = await mission.missionState();
  const [state0, formationId, cx, cy, totalUAVs, inTransition, secsLeft] =
    await mission.getSwarmSummary();
  const [okCount, lateCount, outCount, inactiveCount] =
    await mission.getSwarmCounts();

  console.log("\n  ── Current state ────────────────────────");
  console.log("  State            :", missionStateLabel(stateBefore));
  console.log("  FormationId      :", formationId.toString());
  console.log("  Centroid         : (" + cx.toString() + ", " + cy.toString() + ")");
  console.log("  Total UAVs       :", totalUAVs.toString());
  console.log("  In transition    :", inTransition, inTransition ? `(${secsLeft.toString()}s left)` : "");
  console.log("  OK / LATE / OUT_OF_FORMATION / INACTIVE :",
    okCount.toString(), "/", lateCount.toString(), "/",
    outCount.toString(), "/", inactiveCount.toString());

  if (Number(stateBefore) === 0) {
    console.error("\n  ✘ The contract is already in SETUP — nothing to reset.");
    process.exitCode = 1;
    return;
  }

  console.log("\n  Calling resetMission()...");
  const tx      = await mission.connect(authority).resetMission(GAS);
  const receipt = await tx.wait();
  console.log(`  ✔ Reset complete | gas: ${receipt.gasUsed.toString()} | block: ${receipt.blockNumber}`);

  const stateAfter   = await mission.missionState();
  const uavCountAfter = await mission.getUAVCount();
  const [,,cxAfter, cyAfter,,,] = await mission.getSwarmSummary();

  console.log("\n  ── State after reset ────────────────────");
  console.log("  State       :", missionStateLabel(stateAfter));
  console.log("  UAVs        :", uavCountAfter.toString());
  console.log("  Centroid    : (" + cxAfter.toString() + ", " + cyAfter.toString() + ")");

  if (Number(stateAfter) === 0) {
    console.log("\n  ✔ Contract ready for a new simulation.");
    console.log("    You can run: npx hardhat run scripts/simulate_missionformation.js --network rede_uav");
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