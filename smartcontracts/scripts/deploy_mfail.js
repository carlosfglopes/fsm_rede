// scripts/deploy_mfail.js
// Deploys the MissionFail contract (failure-detection FSM) to rede_uav.
//
// Usage:
//   npx hardhat run scripts/deploy_mfail.js --network rede_uav

const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

// CONTRACT PARAMETERS
const PARAMS = {
  heartbeatTimeoutSec      : 15,   
  quorumThreshold          : 2,    
  abortFailureThreshold    : 2,    
  degradedCapacityThreshold: 2,    
  formationMode            : 0,    
};


const GAS = {
  gasLimit            : 3000000,
  maxFeePerGas        : 2000000000,
  maxPriorityFeePerGas: 1000000000,
};

// HELPERS

function sep(label) {
  console.log(`\n${"─".repeat(41)}`);
  if (label) console.log(`  ${label}`);
  console.log("─".repeat(41));
}

function formationLabel(value) {
  return ["FULL", "REDUCED", "MINIMAL"][value] ?? `UNKNOWN(${value})`;
}

// MAIN

async function main() {
  const [authority] = await hre.ethers.getSigners();

  sep("Deploy MissionFail (Scenario 2)");
  console.log("  Network   :", hre.network.name);
  console.log("  Authority :", authority.address);
  console.log("  Params    :");
  console.log("    heartbeatTimeoutSec      :", PARAMS.heartbeatTimeoutSec);
  console.log("    quorumThreshold          :", PARAMS.quorumThreshold);
  console.log("    abortFailureThreshold    :", PARAMS.abortFailureThreshold);
  console.log("    degradedCapacityThreshold:", PARAMS.degradedCapacityThreshold);
  console.log("    formationMode            :", formationLabel(PARAMS.formationMode),
                                               `(${PARAMS.formationMode})`);

  const MissionFail = await hre.ethers.getContractFactory("MissionFail");

  const contract = await MissionFail.deploy(
    authority.address,
    PARAMS.heartbeatTimeoutSec,
    PARAMS.quorumThreshold,
    PARAMS.abortFailureThreshold,
    PARAMS.degradedCapacityThreshold,
    PARAMS.formationMode,
    GAS
  );

  const deployTx = typeof contract.deploymentTransaction === "function"
    ? contract.deploymentTransaction()
    : contract.deployTransaction;

  console.log("\n  Transaction hash :", deployTx.hash);
  console.log("  Waiting for confirmation...");

  const receipt = await deployTx.wait();

  const contractAddress = contract.address ?? await contract.getAddress();

  sep("Result");
  console.log("  ✔ Contract address :", contractAddress);
  console.log("  ✔ Block number     :", receipt.blockNumber);
  console.log("  ✔ Gas used         :", receipt.gasUsed.toString());

  const state = await contract.missionState();
  console.log("  ✔ Initial state    : SETUP (" + state.toString() + ")");

  const deploymentInfo = {
    contract                 : "MissionFail",
    address                  : contractAddress,
    authority                : authority.address,
    network                  : hre.network.name,
    params                   : {
      ...PARAMS,
      formationModeLabel: formationLabel(PARAMS.formationMode),
    },
    deployedAt               : new Date().toISOString(),
    txHash                   : deployTx.hash,
    blockNumber              : receipt.blockNumber,
    gasUsed                  : receipt.gasUsed.toString(),
  };

  const outPath = path.join(__dirname, "..", "deployed_mfail.json");
  fs.writeFileSync(outPath, JSON.stringify(deploymentInfo, null, 2));

  sep("Next steps");
  console.log("");
  console.log("Run the simulation:");
  console.log(`     npx hardhat run scripts/simulate_missionfail.js --network ${hre.network.name}`);
}

main().catch((err) => {
  console.error("✘ Error:", err.message);
  process.exitCode = 1;
});