const hre = require("hardhat");
const readline = require("readline");

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  let contractName = process.env.CONTRACT;

  if (!contractName) {
    contractName = await prompt("🔤 Enter contract name to deploy (without .sol): ");
  }

  console.log(`📦 Compiling and deploying: ${contractName}...`);

  const ContractFactory = await hre.ethers.getContractFactory(contractName);
  const args = [];
  const constructor = ContractFactory.interface.deploy.inputs;

  for (const input of constructor) {
    const value = await prompt(`🧱 Enter value for ${input.name} (${input.type}): `);
    args.push(value);
  }

  const contract = await ContractFactory.deploy(...args);
  const txHash = contract.deployTransaction.hash;

  await contract.deployed();

  console.log(`✅ ${contractName} deployed to: ${contract.address}`);
  console.log(`🔗 Explorer: https://explorer.helioschainlabs.org/tx/${txHash}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
