// scripts/deploy_mformation.js
// Deploys the MissionFormation contract (formation-keeping FSM) to rede_uav.
//
// Usage:
//   npx hardhat run scripts/deploy_mformation.js --network rede_uav

const hre  = require("hardhat");
const fs   = require("fs");
const path = require("path");

// CONTRACT PARAMETERS
const PARAMS = {
  
  toleranceWindow   : 20,        
  maxViolations     : 2,         
  degradedThreshold : 2,         

  quorum            : 2,

  transitionTime    : 25,        

  formationId       : 0,
  dMinSq            : 4_000_000,   
  dMaxSq            : 64_000_000,  
  rMaxSq            : 25_000_000,  
};

const GAS = {
  gasLimit            : 3000000,
  maxFeePerGas        : 2000000000,
  maxPriorityFeePerGas: 1000000000,
};


function sep(label) {
  console.log(`\n${"─".repeat(50)}`);
  if (label) console.log(`  ${label}`);
  console.log("─".repeat(50));
}

function formationLabel(id) {
  return ["LINE", "V", "CIRCLE"][id] ?? `CUSTOM(${id})`;
}

function sqrtApprox(n) {
  return Math.round(Math.sqrt(n) / 1000 * 10) / 10;
}


async function main() {
  const [authority] = await hre.ethers.getSigners();

  sep("Deploy MissionFormation (Scenario 3)");
  console.log("  Network   :", hre.network.name);
  console.log("  Authority :", authority.address);

  sep("Parameters");
  console.log("  toleranceWindow   :", PARAMS.toleranceWindow, "s");
  console.log("  maxViolations     :", PARAMS.maxViolations);
  console.log("  degradedThreshold :", PARAMS.degradedThreshold, "non-OK UAVs");
  console.log("  quorum            :", PARAMS.quorum, "votes to confirm violation");
  console.log("  transitionTime    :", PARAMS.transitionTime, "s (grace period)");
  console.log("");
  console.log("  Initial formation :", formationLabel(PARAMS.formationId),
                                      `(id=${PARAMS.formationId})`);
  console.log("  dMin ≈", sqrtApprox(PARAMS.dMinSq), "u  →  dMinSq =", PARAMS.dMinSq);
  console.log("  dMax ≈", sqrtApprox(PARAMS.dMaxSq), "u  →  dMaxSq =", PARAMS.dMaxSq);
  console.log("  rMax ≈", sqrtApprox(PARAMS.rMaxSq), "u  →  rMaxSq =", PARAMS.rMaxSq);

  const MissionFormation = await hre.ethers.getContractFactory("MissionFormation");

  const contract = await MissionFormation.deploy(
    authority.address,
    PARAMS.toleranceWindow,
    PARAMS.maxViolations,
    PARAMS.degradedThreshold,
    PARAMS.transitionTime,
    PARAMS.quorum,
    PARAMS.formationId,
    PARAMS.dMinSq,
    PARAMS.dMaxSq,
    PARAMS.rMaxSq,
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

  const state      = await contract.missionState();
  const formation  = await contract.currentFormation();
  console.log("  ✔ Initial state    : SETUP (" + state.toString() + ")");
  console.log("  ✔ formationId      :", formation.formationId.toString(),
                                       "→", formationLabel(Number(formation.formationId)));


  const deploymentInfo = {
    contract    : "MissionFormation",
    address     : contractAddress,
    authority   : authority.address,
    network     : hre.network.name,
    params      : {
      ...PARAMS,
      formationLabel : formationLabel(PARAMS.formationId),
      dMinApprox     : sqrtApprox(PARAMS.dMinSq) + " units",
      dMaxApprox     : sqrtApprox(PARAMS.dMaxSq) + " units",
      rMaxApprox     : sqrtApprox(PARAMS.rMaxSq) + " units",
    },
    deployedAt  : new Date().toISOString(),
    txHash      : deployTx.hash,
    blockNumber : receipt.blockNumber,
    gasUsed     : receipt.gasUsed.toString(),
  };

  const outPath = path.join(__dirname, "..", "deployed_mformation.json");
  fs.writeFileSync(outPath, JSON.stringify(deploymentInfo, null, 2));

  sep("Next steps");
  console.log("");
  console.log(" Run the simulation:");
  console.log(`     npx hardhat run scripts/simulate_missionformation.js --network ${hre.network.name}`);
}

main().catch((err) => {
  console.error("✘ Error:", err.message);
  process.exitCode = 1;
});
