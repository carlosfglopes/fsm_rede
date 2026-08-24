// scripts/fund_uavs.js
// Sends ETH from the authority account to the simulated UAV accounts.
// Run ONCE before any simulate_*.js script.
//
// Usage: npx hardhat run scripts/fund_uavs.js --network rede_uav

const hre = require("hardhat");

const UAV_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
];


const GAS = {
  gasLimit            : 21000,
  maxFeePerGas        : 2000000000,
  maxPriorityFeePerGas: 1000000000,
};

async function main() {

  const [authority] = await hre.ethers.getSigners();
  const provider    = authority.provider ?? hre.ethers.provider;

  const uavWallets = UAV_KEYS.map(key => new hre.ethers.Wallet(key, provider));

  console.log("─────────────────────────────────────────");
  console.log("  Fund UAV Accounts");
  console.log("─────────────────────────────────────────");
  console.log("Authority :", authority.address);
  console.log("");

  for (let i = 0; i < uavWallets.length; i++) {
    const uav     = uavWallets[i];
    const balance = await provider.getBalance(uav.address);
    const balanceBN = BigInt(balance.toString());

    console.log(`UAV[${i+1}] ${uav.address}`);
    console.log(`  Current balance: ${balanceBN.toString()} wei`);

    if (balanceBN >= BigInt("500000000000000000")) {
      console.log(`  ✔ Already has sufficient balance — skipping\n`);
      continue;
    }

    const tx = await authority.sendTransaction({
      to   : uav.address,
      value: hre.ethers.utils.parseEther("1"),
      ...GAS,
    });

    const receipt = await tx.wait();
    console.log(`  ✔ Sent 1 ETH | block: ${receipt.blockNumber}\n`);
  }

  console.log("✔ UAV accounts funded. You can now run simulate_mission1.js.");
}

main().catch((err) => {
  console.error("✘ Error:", err.message);
  process.exitCode = 1;
});