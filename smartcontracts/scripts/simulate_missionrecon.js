// scripts/simulate_missionrecon.js
// Runs a full end-to-end scenario against the deployed MissionRecon contract
// (register UAVs, run leader election, submit a mission report).
//
// Usage:
//   npx hardhat run scripts/simulate_missionrecon.js --network rede_uav

//   SCENARIO=inconclusive npx hardhat run scripts/simulate_missionrecon.js --network rede_uav
//   $env:SCENARIO="inconclusive"; npx hardhat run scripts/simulate_missionrecon.js --network rede_uav

//   SCENARIO=timeout      npx hardhat run scripts/simulate_missionrecon.js --network rede_uav
//   $env:SCENARIO="timeout"; npx hardhat run scripts/simulate_missionrecon.js --network rede_uav

const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

// CONFIGURATION
const SCENARIO = process.env.SCENARIO || "success";

const DEPLOY_PARAMS = {
  minUAVsForElection : 2,
  reportTimeoutSec   : 20, 
  maxReelections     : 2,
  weightBattery      : 60,
  weightSpeed        : 40,
};

const UAV_PROFILES = [
  { battery: 92, speed: 110 },
  { battery: 78, speed: 140 },
  { battery: 65, speed: 160 },
];

const GAS = {
  gasLimit            : 3000000,
  maxFeePerGas        : 2000000000,
  maxPriorityFeePerGas: 1000000000,
};
const GAS_UAV = GAS;

const UAV_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
];

// HELPERS

async function increaseTime(seconds) {
  try {
    
    await hre.network.provider.send("evm_increaseTime", [seconds]);
    await hre.network.provider.send("evm_mine");
  } catch (e) {
    if (e.message && e.message.includes("Method not found")) {

      console.log(`  (real network: waiting ${seconds}s in real time...)`);
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    } else {
      throw e;
    }
  }
}

function keccak256(str) {
  const bytes = Buffer.from(str, "utf8");
  if (typeof hre.ethers.utils !== "undefined") {
    return hre.ethers.utils.keccak256(bytes); 
  }
  return hre.ethers.keccak256(bytes);         
}

async function getAddress(contract) {
  return contract.address ?? await contract.getAddress();
}

function reportResultLabel(value) {
  const labels = { 0: "NONE", 1: "TARGET_DETECTED", 2: "NOTHING_FOUND", 3: "INCONCLUSIVE" };
  return labels[Number(value)] ?? `UNKNOWN(${value})`;
}

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

async function sendTx(txPromise, label) {
  const tx      = await txPromise;
  const receipt = await tx.wait();
  console.log(`  [${label}] gas: ${receipt.gasUsed.toString()} | block: ${receipt.blockNumber}`);
  return receipt;
}

// DEPLOY OR ATTACH

async function getContract(authority) {
  const MissionRecon = await hre.ethers.getContractFactory("MissionRecon");

  if (process.env.MISSION_ADDRESS) {
    console.log("Attach via MISSION_ADDRESS:", process.env.MISSION_ADDRESS);
    return MissionRecon.attach(process.env.MISSION_ADDRESS);
  }

  const jsonPath = path.join(__dirname, "..", "deployed_mrecon.json");
  if (fs.existsSync(jsonPath)) {
    const info = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    if (info.network === hre.network.name) {
      console.log("Attach via deployed_mrecon.json:", info.address);
      return MissionRecon.attach(info.address);
    }
  }

  console.log("No contract found — deploying a new one...");
  const contract = await MissionRecon.deploy(
    authority.address,
    DEPLOY_PARAMS.minUAVsForElection,
    DEPLOY_PARAMS.reportTimeoutSec,
    DEPLOY_PARAMS.maxReelections,
    DEPLOY_PARAMS.weightBattery,
    DEPLOY_PARAMS.weightSpeed,
    GAS
  );

  const deployTx = typeof contract.deploymentTransaction === "function"
    ? contract.deploymentTransaction()
    : contract.deployTransaction;

  const receipt = await deployTx.wait();
  const address = contract.address ?? await contract.getAddress();
  console.log("Deployed at:", address, "| gas:", receipt.gasUsed.toString());
  return contract;
}

// MISSION SETUP

async function permitAndRegisterUAVs(mission, authority, uavs) {
  sep("SETUP — Permit + Activate + Register");

  for (const uav of uavs) {
    await sendTx(mission.connect(authority).permitUAV(uav.address, GAS), "permitUAV");
    console.log(`  ✔ Permitted: ${uav.address}`);
  }

  await sendTx(mission.connect(authority).activateMission("Zone-Alpha", GAS), "activateMission");
  console.log("  ✔ Mission activated → Zone-Alpha");

  for (const uav of uavs) {
    await sendTx(mission.connect(uav).registerUAV(GAS_UAV), "registerUAV");
    console.log(`  ✔ Registered: ${uav.address}`);
  }
}

async function publishInitialStatuses(mission, uavSigners) {
  sep("STATUS PUBLISH");

  for (let i = 0; i < uavSigners.length; i++) {
    const signer  = uavSigners[i];
    const profile = UAV_PROFILES[i];

    await sendTx(
      mission.connect(signer).publishStatus(profile.battery, profile.speed, GAS_UAV),
      `publishStatus UAV[${i + 1}]`
    );
    const data = await mission.uavs(signer.address);
    console.log(`  UAV[${i+1}] battery=${profile.battery} speed=${profile.speed} score=${data.score}`);
  }
}

async function startElectionAndShowLeader(mission, authority) {
  sep("ELECTION");

  await sendTx(mission.connect(authority).startElection(GAS), "startElection");

  const leader = await mission.electedLeader();
  const state  = await mission.missionState();
  console.log("  Leader elected:", leader);
  console.log("  Mission state :", missionStateLabel(state));

  return leader;
}

// SCENARIOS

async function runSuccessScenario(mission, leaderAddress, signersByAddress) {
  sep("SCENARIO: SUCCESS");

  const leader       = signersByAddress[leaderAddress.toLowerCase()];
  const evidenceHash = keccak256("mission-evidence-success");

  console.log("  Leader submits TARGET_DETECTED");
  await sendTx(
    mission.connect(leader).submitReport(1, evidenceHash, GAS_UAV),
    "submitReport(TARGET_DETECTED)"
  );

  const summary = await mission.getMissionSummary();
  console.log("\n  ── Final result ──────────────────────");
  console.log("  State    :", missionStateLabel(summary.state));
  console.log("  Leader   :", summary.leader);
  console.log("  Report   :", reportResultLabel(summary.report));
  console.log("  Evidence :", summary.evidenceHash);
}

async function runInconclusiveScenario(mission, leaderAddress, signersByAddress) {
  sep("SCENARIO: INCONCLUSIVE");

  const leader       = signersByAddress[leaderAddress.toLowerCase()];
  const evidenceHash = keccak256("mission-evidence-inconclusive");

  console.log("  Leader submits INCONCLUSIVE → re-election");
  await sendTx(
    mission.connect(leader).submitReport(3, evidenceHash, GAS_UAV),
    "submitReport(INCONCLUSIVE)"
  );

  const newLeader   = await mission.electedLeader();
  const reelections = await mission.reelectionCount();
  const state       = await mission.missionState();

  console.log("\n  ── Result after re-election ──────────");
  console.log("  Reelections:", reelections.toString());
  console.log("  New leader :", newLeader);
  console.log("  State      :", missionStateLabel(state));
}

async function runTimeoutScenario(mission, authority) {
  sep("SCENARIO: TIMEOUT");

  const timeoutSec = Number(await mission.reportTimeoutSec());
  const waitSec    = timeoutSec + 1;
  console.log(`  Waiting ${waitSec}s (contract timeout: ${timeoutSec}s)...`);
  await increaseTime(waitSec);

  console.log("  Calling checkTimeout()...");
  await sendTx(mission.connect(authority).checkTimeout(GAS), "checkTimeout");

  const newLeader   = await mission.electedLeader();
  const reelections = await mission.reelectionCount();
  const state       = await mission.missionState();

  console.log("\n  ── Result after timeout ──────────────");
  console.log("  Reelections:", reelections.toString());
  console.log("  New leader :", newLeader);
  console.log("  State      :", missionStateLabel(state));
}

// MAIN

async function main() {
  const [authority] = await hre.ethers.getSigners();
  const provider    = authority.provider ?? hre.ethers.provider;

  const uav1 = new hre.ethers.Wallet(UAV_KEYS[0], provider);
  const uav2 = new hre.ethers.Wallet(UAV_KEYS[1], provider);
  const uav3 = new hre.ethers.Wallet(UAV_KEYS[2], provider);

  sep("MissionRecon — Scenario 1 Simulation");
  console.log("  Network   :", hre.network.name);
  console.log("  Authority :", authority.address);
  console.log("  UAV1      :", uav1.address);
  console.log("  UAV2      :", uav2.address);
  console.log("  UAV3      :", uav3.address);
  console.log("  Scenario  :", SCENARIO);

  const signersByAddress = {
    [uav1.address.toLowerCase()]: uav1,
    [uav2.address.toLowerCase()]: uav2,
    [uav3.address.toLowerCase()]: uav3,
  };

  const mission = await getContract(authority);

  await permitAndRegisterUAVs(mission, authority, [uav1, uav2, uav3]);
  await publishInitialStatuses(mission, [uav1, uav2, uav3]);
  const leaderAddress = await startElectionAndShowLeader(mission, authority);

  if (SCENARIO === "success") {
    await runSuccessScenario(mission, leaderAddress, signersByAddress);
  } else if (SCENARIO === "inconclusive") {
    await runInconclusiveScenario(mission, leaderAddress, signersByAddress);
  } else if (SCENARIO === "timeout") {
    await runTimeoutScenario(mission, authority);
  } else {
    throw new Error(`Invalid scenario: "${SCENARIO}". Use: success | inconclusive | timeout`);
  }

  sep("END");
}

main().catch((err) => {
  console.error("✘ Error:", err.message);
  process.exitCode = 1;
});