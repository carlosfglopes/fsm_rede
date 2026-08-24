// scripts/deploy_mrecon.js
// Deploys the MissionRecon contract (leader-election FSM) to rede_uav.
//
// Usage:
//   npx hardhat run scripts/deploy_mrecon.js --network rede_uav

const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

// CONTRACT PARAMETERS
const PARAMS = {
  minUAVsForElection : 2,
  reportTimeoutSec   : 20,
  maxReelections     : 2,
  weightBattery      : 60,
  weightSpeed        : 40,
};


const GAS = {
  gasLimit            : 3000000,
  maxFeePerGas        : 2_000_000_000n,
  maxPriorityFeePerGas: 1_000_000_000n,
};

async function main() {
  if (PARAMS.weightBattery + PARAMS.weightSpeed !== 100) {
    throw new Error(`weightBattery + weightSpeed must be 100`);
  }

  const [authority] = await hre.ethers.getSigners();

  console.log("─────────────────────────────────────────");
  console.log("  Deploy MissionRecon (Scenario 1)");
  console.log("─────────────────────────────────────────");
  console.log("Network   :", hre.network.name);
  console.log("Authority :", authority.address);
  console.log("Params    :", PARAMS);
  console.log("");

  const MissionRecon = await hre.ethers.getContractFactory("MissionRecon");

  const contract = await MissionRecon.deploy(
    authority.address,
    PARAMS.minUAVsForElection,
    PARAMS.reportTimeoutSec,
    PARAMS.maxReelections,
    PARAMS.weightBattery,
    PARAMS.weightSpeed,
    GAS
  );


  const deployTx = typeof contract.deploymentTransaction === "function"
    ? contract.deploymentTransaction()
    : contract.deployTransaction;

  console.log("Transaction hash :", deployTx.hash);
  console.log("Waiting for confirmation...");

  const receipt = await deployTx.wait();

  const contractAddress = contract.address
    ?? await contract.getAddress();

  console.log("\n✔ Contract address :", contractAddress);
  console.log("✔ Block number     :", receipt.blockNumber);
  console.log("✔ Gas used         :", receipt.gasUsed.toString());

  const deploymentInfo = {
    contract   : "MissionRecon",
    address    : contractAddress,
    authority  : authority.address,
    network    : hre.network.name,
    params     : PARAMS,
    deployedAt : new Date().toISOString(),
    txHash     : deployTx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed    : receipt.gasUsed.toString(),
  };

  const outPath = path.join(__dirname, "..", "deployed_mrecon.json");
  fs.writeFileSync(outPath, JSON.stringify(deploymentInfo, null, 2));

  console.log("✔ Information saved to deployed_mrecon.json");
  console.log("\nNext step:");
  console.log("  npx hardhat run scripts/simulate_missionrecon.js --network", hre.network.name);
}

main().catch((err) => {
  console.error("✘ Error:", err.message);
  process.exitCode = 1;
});