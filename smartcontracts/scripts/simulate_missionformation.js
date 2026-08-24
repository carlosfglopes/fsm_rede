// scripts/simulate_missionformation.js
// Runs a full end-to-end scenario against the deployed MissionFormation contract
// (register UAVs, start mission, report positions, trigger a violation/recovery).
//
// Usage:
//   npx hardhat run scripts/simulate_missionformation.js --network rede_uav
//   SCENARIO=violation        npx hardhat run scripts/simulate_missionformation.js --network rede_uav
//   $env:SCENARIO="violation"; npx hardhat run scripts/simulate_missionformation.js --network rede_uav

//   SCENARIO=late             npx hardhat run scripts/simulate_missionformation.js --network rede_uav
//   $env:SCENARIO="late"; npx hardhat run scripts/simulate_missionformation.js --network rede_uav

//   SCENARIO=formation_change npx hardhat run scripts/simulate_missionformation.js --network rede_uav
//   $env:SCENARIO="formation_change"; npx hardhat run scripts/simulate_missionformation.js --network rede_uav


const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

const SCENARIO = process.env.SCENARIO || "nominal";


const LINE_POSITIONS = [
  { x:    0, y: 0 },
  { x: 3000, y: 0 },
  { x: 6000, y: 0 },
];


const V_POSITIONS = [
  { x: 1500, y:    0 },  
  { x: 3000, y: 2000 },  
  { x: 4500, y:    0 },  
];


const VIOLATION_POS = { x: 12000, y: 0 };

const GAS = {
  gasLimit            : 3000000,
  maxFeePerGas        : 2000000000,
  maxPriorityFeePerGas: 1000000000,
};

const UAV_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
];


async function increaseTime(seconds) {
  try {
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine");
  } catch (e) {
    if (e.message && e.message.includes("Method not found")) {
      console.log(`  (real network: waiting ${seconds}s...)`);
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    } else {
      throw e;
    }
  }
}

function keccak256(str) {
  const bytes = Buffer.from(str, "utf8");
  if (typeof hre.ethers.utils !== "undefined") return hre.ethers.utils.keccak256(bytes);
  return hre.ethers.keccak256(bytes);
}

function missionStateLabel(v) {
  const l = { 0:"SETUP", 1:"ACTIVE", 2:"RECONFIGURING_FORMATION",
              3:"DEGRADED", 4:"COMPLETED", 5:"ABORTED" };
  return l[Number(v)] ?? `UNKNOWN(${v})`;
}

function uavStateLabel(v) {
  return ["OK","LATE","OUT_OF_FORMATION","INACTIVE"][Number(v)] ?? `UNKNOWN(${v})`;
}

function formationLabel(v) {
  return ["LINE","V","CIRCLE"][Number(v)] ?? `CUSTOM(${v})`;
}

function sep(label) {
  console.log(`\n${"─".repeat(50)}`);
  if (label) console.log(`  ${label}`);
  console.log("─".repeat(50));
}

async function sendTx(txPromise, label) {
  const tx      = await txPromise;
  const receipt = await tx.wait();
  console.log(`  [${label}] gas: ${receipt.gasUsed.toString()} | block: ${receipt.blockNumber}`);
  return receipt;
}

async function printSummary(mission, uavSigners) {
  const s        = await mission.getSwarmSummary();
  const c        = await mission.getSwarmCounts();
  const centroid = await mission.getCentroid();
  const quorum   = await mission.quorum();

  console.log("\n  ── Swarm State ───────────────────────────");
  console.log("  State      :", missionStateLabel(s.state));
  console.log("  Formation  :", formationLabel(s.formationId), `(id=${s.formationId})`);
  console.log(`  Centroid   : (${centroid.x}, ${centroid.y})`);
  console.log("  Total UAVs :", s.totalUAVs.toString());
  console.log(`  Counts     : OK=${c.okCount} LATE=${c.lateCount} OUT=${c.outOfFormationCount} INACTIVE=${c.inactiveCount}`);
  console.log(`  Quorum     : ${quorum} votes to confirm violation`);
  if (s.inTransition) {
    console.log("  Transition : in progress |", s.transitionSecsLeft.toString(), "s left");
  }

  console.log("\n  ── Individual UAV State ──────────────────");
  for (let i = 0; i < uavSigners.length; i++) {
    const st        = await mission.getUAVStatus(uavSigners[i].address);
    const distSqStr = st.distToCentroidSq.toString().padStart(12);
    const vVotes    = `vVotes=${st.votes}/${quorum}`;
    const rVotes    = `rVotes=${st.recovVotes}/${quorum}`;
    console.log(
      `  UAV${i+1} ${uavSigners[i].address.slice(0,10)}…` +
      `  state=${uavStateLabel(st.state).padEnd(18)}` +
      `  pos=(${String(st.x).padStart(6)},${String(st.y).padStart(6)})` +
      `  distSq=${distSqStr}` +
      `  viol=${st.violationCount}` +
      `  ${vVotes}  ${rVotes}`
    );
  }
}

// GET CONTRACT

async function getContract(authority) {
  const MissionFormation = await hre.ethers.getContractFactory("MissionFormation");

  if (process.env.MISSION_ADDRESS) {
    console.log("  Attach via MISSION_ADDRESS:", process.env.MISSION_ADDRESS);
    return MissionFormation.attach(process.env.MISSION_ADDRESS);
  }

  const jsonPath = path.join(__dirname, "..", "deployed_mformation.json");
  if (fs.existsSync(jsonPath)) {
    const info = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    if (info.network === hre.network.name) {
      console.log("  Attach via deployed_mformation.json:", info.address);
      return MissionFormation.attach(info.address);
    }
  }

  throw new Error("Contract not found. Run deploy_mformation.js first.");
}

// MISSION SETUP

async function setupAndStart(mission, authority, uavSigners) {
  sep("SETUP — Register + Start");

  const state = await mission.missionState();
  if (Number(state) !== 0) {
    console.log(`  Current state: ${missionStateLabel(state)} — skipping setup`);
    return;
  }

  for (let i = 0; i < uavSigners.length; i++) {
    const pos = LINE_POSITIONS[i];
    await sendTx(
      mission.connect(authority).registerUAV(uavSigners[i].address, pos.x, pos.y, GAS),
      `registerUAV UAV${i + 1}`
    );
    console.log(`  ✔ UAV${i+1}: ${uavSigners[i].address} | pos=(${pos.x},${pos.y})`);
  }

  await sendTx(mission.connect(authority).startMission(GAS), "startMission");
  console.log("  ✔ Mission started → ACTIVE");
}

// UPDATE ROUND

async function positionRound(mission, uavSigners, positions, label, skipUavIndex = -1) {
  sep(label);
  for (let i = 0; i < uavSigners.length; i++) {
    if (i === skipUavIndex) {
      console.log(`  UAV${i+1}: no update (deliberate)`);
      continue;
    }
    const pos = positions[i];
    await sendTx(
      mission.connect(uavSigners[i]).updatePosition(pos.x, pos.y, GAS),
      `updatePosition UAV${i+1} (${pos.x},${pos.y})`
    );
  }
}

async function reportRound(mission, reporters, accused, label) {
  sep(label);
  for (const reporter of reporters) {
    await sendTx(
      mission.connect(reporter).reportViolation(accused.address, GAS),
      `reportViolation ${reporter.address.slice(0,10)}… → ${accused.address.slice(0,10)}…`
    );
  }
}

async function recoveryRound(mission, reporters, recovered, label) {
  sep(label);
  for (const reporter of reporters) {
    await sendTx(
      mission.connect(reporter).reportRecovery(recovered.address, GAS),
      `reportRecovery ${reporter.address.slice(0,10)}… → ${recovered.address.slice(0,10)}…`
    );
  }
}

// SCENARIOS

async function runNominalScenario(mission, authority, uavSigners) {
  console.log("\n  Continuous monitoring — 3 rounds in LINE formation");

  for (let round = 1; round <= 3; round++) {
    await positionRound(mission, uavSigners, LINE_POSITIONS, `ROUND ${round} — Valid positions`);
    await printSummary(mission, uavSigners);
  }
}

async function runViolationScenario(mission, authority, uavSigners) {


  const [uav1, uav2, uav3] = uavSigners;


  await positionRound(mission, uavSigners, LINE_POSITIONS, "ROUND 1 — Valid positions");
  await printSummary(mission, uavSigners);


  const violationRound = [...LINE_POSITIONS];
  violationRound[2] = VIOLATION_POS;

  await positionRound(mission, uavSigners, violationRound,
    "ROUND 2 — UAV3 drifts to VIOLATION_POS");
  await reportRound(mission, [uav1, uav2], uav3,
    "ROUND 2 — UAV1+UAV2 report UAV3 → quorum → violationCount UAV3 = 1");
  await printSummary(mission, uavSigners);

  await positionRound(mission, uavSigners, violationRound,
    "ROUND 3 — UAV3 stays at VIOLATION_POS");
  await reportRound(mission, [uav1, uav2], uav3,
    "ROUND 3 — UAV1+UAV2 report → quorum → violationCount=2 → UAV3 OUT_OF_FORMATION");
  await printSummary(mission, uavSigners);

  await positionRound(mission, uavSigners, LINE_POSITIONS,
    "ROUND 4 — UAV3 returns to LINE_POSITIONS (votes cleared, OUT remains until confirmation)");
  await printSummary(mission, uavSigners);

  await recoveryRound(mission, [uav1, uav2], uav3,
    "ROUND 4b — UAV1+UAV2 confirm UAV3 recovery → quorum → UAV3 OK → ACTIVE");
  await printSummary(mission, uavSigners);
}

async function runLateScenario(mission, authority, uavSigners) {

  const [uav1, uav2, uav3] = uavSigners;

  await positionRound(mission, uavSigners, LINE_POSITIONS, "ROUND 1 — All report");
  await printSummary(mission, uavSigners);

  sep("PAUSE — UAV3 silent");
  const toleranceSec = Number(await mission.toleranceWindow());
  const waitSec      = toleranceSec + 2;
  console.log(`  UAV3 sends nothing for ${waitSec}s (toleranceWindow=${toleranceSec}s)`);
  console.log(`  UAV1 and UAV2 will report AFTER the timeout → their lastUpdate stays fresh`);

  await increaseTime(waitSec);

  await sendTx(mission.connect(uav1).updatePosition(
    LINE_POSITIONS[0].x, LINE_POSITIONS[0].y, GAS), "updatePosition UAV1");
  await sendTx(mission.connect(uav2).updatePosition(
    LINE_POSITIONS[1].x, LINE_POSITIONS[1].y, GAS), "updatePosition UAV2");

  await sendTx(mission.connect(authority).checkLateUAVs(GAS), "checkLateUAVs");
  console.log("  → UAV3 should be LATE; UAV1 and UAV2 OK (1 non-OK < degradedThreshold=2 → ACTIVE)");
  await printSummary(mission, uavSigners);

  await positionRound(mission, uavSigners, LINE_POSITIONS,
    "RECOVERY — UAV3 resumes reporting → LATE → OK → ACTIVE");
  await printSummary(mission, uavSigners);
}

async function runFormationChangeScenario(mission, authority, uavSigners) {

  await positionRound(mission, uavSigners, LINE_POSITIONS, "ROUND 1 — LINE formation (valid)");
  await printSummary(mission, uavSigners);

  sep("FORMATION CHANGE: LINE → V");
  const transitionSec = Number(await mission.transitionTime());
  console.log(`  Grace period: ${transitionSec}s — violations do not count during the transition`);

  await sendTx(
    mission.connect(authority).changeFormation(
      1,
      4_000_000,
      64_000_000,
      25_000_000,
      GAS
    ),
    "changeFormation → V"
  );
  await printSummary(mission, uavSigners);

  await positionRound(
    mission, uavSigners, V_POSITIONS,
    "TRANSITION — UAVs reposition to V formation (no penalty)"
  );
  await printSummary(mission, uavSigners);

  sep("END OF GRACE PERIOD");
  const waitSec = transitionSec + 1;
  console.log(`  Waiting ${waitSec}s for the transition to end...`);
  await increaseTime(waitSec);

  await sendTx(mission.connect(authority).finalizeFormationChange(GAS), "finalizeFormationChange");
  console.log("  ✔ V formation applied — validation resumed with new constraints");
  await printSummary(mission, uavSigners);

  await positionRound(mission, uavSigners, V_POSITIONS, "ROUND 2 — Valid V positions post-transition");
  await printSummary(mission, uavSigners);
}

// MAIN

async function main() {
  const [authority] = await hre.ethers.getSigners();
  const provider    = authority.provider ?? hre.ethers.provider;

  const uav1 = new hre.ethers.Wallet(UAV_KEYS[0], provider);
  const uav2 = new hre.ethers.Wallet(UAV_KEYS[1], provider);
  const uav3 = new hre.ethers.Wallet(UAV_KEYS[2], provider);
  const uavSigners = [uav1, uav2, uav3];

  sep("MissionFormation — Scenario 3 Simulation");
  console.log("  Network   :", hre.network.name);
  console.log("  Authority :", authority.address);
  console.log("  UAV1      :", uav1.address);
  console.log("  UAV2      :", uav2.address);
  console.log("  UAV3      :", uav3.address);
  console.log("  Scenario  :", SCENARIO);

  const mission = await getContract(authority);

  await setupAndStart(mission, authority, uavSigners);

  if      (SCENARIO === "nominal")          await runNominalScenario(mission, authority, uavSigners);
  else if (SCENARIO === "violation")        await runViolationScenario(mission, authority, uavSigners);
  else if (SCENARIO === "late")             await runLateScenario(mission, authority, uavSigners);
  else if (SCENARIO === "formation_change") await runFormationChangeScenario(mission, authority, uavSigners);
  else throw new Error(`Invalid scenario: "${SCENARIO}". Use: nominal | violation | late | formation_change`);

  sep("FINAL RESULT");
  await printSummary(mission, uavSigners);

  sep("END");
}

main().catch((err) => {
  console.error("✘ Error:", err.message);
  process.exitCode = 1;
});
