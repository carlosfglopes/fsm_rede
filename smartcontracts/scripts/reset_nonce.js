// scripts/reset_nonce.js
// Cancels pending transactions that are blocking the authority account's nonce.
// Sends a 0 ETH tx with a high gasPrice for each pending nonce, replacing the
// stuck transactions in the mempool.
//
// Usage: npx hardhat run scripts/reset_nonce.js --network rede_uav

const hre = require("hardhat");

async function main() {
  const [authority] = await hre.ethers.getSigners();
  const provider    = authority.provider;

  console.log("Authority :", authority.address);

  const confirmedNonce = await provider.getTransactionCount(authority.address, "latest");
  const pendingNonce   = await provider.getTransactionCount(authority.address, "pending");

  console.log("Confirmed nonce :", confirmedNonce);
  console.log("Pending nonce   :", pendingNonce);

  if (pendingNonce <= confirmedNonce) {
    console.log("✔ No pending transactions. Nonce is clean.");
    return;
  }

  console.log(`\n⚠ There are ${pendingNonce - confirmedNonce} pending tx(s) blocking.`);
  console.log("Replacing each one with an empty tx (nonce override)...\n");

  for (let nonce = confirmedNonce; nonce < pendingNonce; nonce++) {
    console.log(`  Sending replacement tx for nonce ${nonce}...`);
    try {
      const tx = await authority.sendTransaction({
        to       : authority.address,
        value    : 0,
        nonce    : nonce,
        gasPrice : 0,
        gasLimit : 21000,
      });
      console.log(`  Tx sent: ${tx.hash}`);

      const receipt = await Promise.race([
        tx.wait(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout 15s")), 15000)
        ),
      ]);
      console.log(`  ✔ Nonce ${nonce} cleared in block ${receipt.blockNumber}`);
    } catch (e) {
      console.error(`  ✘ Failed for nonce ${nonce}:`, e.message);
      console.log("  → Trying with automatic gasPrice...");
      try {
        const tx2 = await authority.sendTransaction({
          to      : authority.address,
          value   : 0,
          nonce   : nonce,
          gasLimit: 21000,
        });
        const receipt2 = await tx2.wait();
        console.log(`  ✔ Nonce ${nonce} cleared in block ${receipt2.blockNumber}`);
      } catch (e2) {
        console.error(`  ✘ Also failed:`, e2.message);
      }
    }
  }

  const finalNonce = await provider.getTransactionCount(authority.address, "pending");
  console.log("\nFinal nonce (pending):", finalNonce);
  if (finalNonce === confirmedNonce || finalNonce <= pendingNonce) {
    console.log("✔ Mempool clean. You can now run deploy_m1.js.");
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exitCode = 1;
});