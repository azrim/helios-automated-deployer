const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// This now correctly points to the main deployments log in the project root.
const DEPLOYMENTS_LOG_PATH = path.join(__dirname, '../deployments.json');

// --- Configuration ---
const CHRONOS_CONTRACTS = [
    { logName: 'FeeCollector', requiredCount: 2 },
    { logName: 'DailyReporter', requiredCount: 2 }
];
const ALL_CONTRACT_LOG_NAMES = [
    'RandomToken', 'RandomNFT', 'AIAgent', 'HyperionQuery', 'Heartbeat',
    'FeeCollector', 'DailyReporter' 
];

function executeCommand(command) {
    return new Promise((resolve, reject) => {
        console.log(`\n> Executing: ${command}\n`);
        const childProcess = exec(command);
        childProcess.stdout.pipe(process.stdout);
        childProcess.stderr.pipe(process.stderr);
        childProcess.on('close', (code) => {
            if (code !== 0) reject(new Error(`Command failed with exit code ${code}`));
            else resolve();
        });
    });
}

function getDeploymentsFromLast24Hours() {
    if (!fs.existsSync(DEPLOYMENTS_LOG_PATH)) {
        console.log(`Deployment log not found. Assuming 0 deployments.`);
        return [];
    }
    const deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_LOG_PATH, 'utf-8'));
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));

    return Object.values(deployments).filter(dep => {
        if (!dep.timestamp) return false;
        const deploymentDate = new Date(dep.timestamp);
        return deploymentDate > twentyFourHoursAgo;
    });
}

function getNextContractToDeploy() {
    const recentDeployments = getDeploymentsFromLast24Hours();
    console.log(`Found ${recentDeployments.length} deployments in the last 24 hours.`);

    for (const contract of CHRONOS_CONTRACTS) {
        const count = recentDeployments.filter(d => d.logName === contract.logName).length;
        console.log(`   - ${contract.logName} has been deployed ${count} times.`);
        if (count < contract.requiredCount) {
            console.log(`   -> Decision: Deploying mandatory contract: ${contract.logName}`);
            return contract.logName;
        }
    }

    const randomLogName = ALL_CONTRACT_LOG_NAMES[Math.floor(Math.random() * ALL_CONTRACT_LOG_NAMES.length)];
    console.log(`   -> Decision: Deploying random contract: ${randomLogName}`);
    return randomLogName;
}

async function main() {
    try {
        const logNameToDeploy = getNextContractToDeploy();
        if (!logNameToDeploy) {
            console.log("No contract to deploy at this time.");
            return;
        }

        const command = `npx hardhat deploy --log-name ${logNameToDeploy} --network heliosTestnet`;
        await executeCommand(command);
        console.log(`\n✅ Successfully completed deployment for ${logNameToDeploy}.`);

    } catch (error) {
        console.error('\n❌ An error occurred during the scheduled deployment:', error.message);
        process.exit(1);
    }
}

main();