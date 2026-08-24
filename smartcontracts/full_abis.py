"""
Full state-changing ABIs for the 3 Model 1 contracts, used to decode
transactions in metrics.py. Combines the functions already used in the
authority*.py scripts with the UAVs' self-service functions that only the
agents call (and which therefore did not appear in the existing
authority*.py scripts' partial ABIs).

Not run directly — imported by the authority and agent scripts.
"""

FULL_RECON_ABI = [
    {"inputs": [{"name": "_uav", "type": "address"}], "name": "permitUAV",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_zone", "type": "string"}], "name": "activateMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "startElection",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "resetMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "terminateMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "registerUAV",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_battery", "type": "uint256"}, {"name": "_speed", "type": "uint256"}],
     "name": "publishStatus", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_result", "type": "uint8"}, {"name": "_evidenceHash", "type": "bytes32"}],
     "name": "submitReport", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "checkTimeout",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
]

FULL_FAIL_ABI = [
    {"inputs": [{"name": "_uav", "type": "address"}, {"name": "_capacityMax", "type": "uint256"}],
     "name": "registerUAV", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "taskId", "type": "uint256"}, {"name": "assignedTo", "type": "address"}],
     "name": "createTask", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "startMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_suspect", "type": "address"}, {"name": "_evidenceHash", "type": "bytes32"}],
     "name": "detectMissingHeartbeat", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_suspect", "type": "address"}, {"name": "_evidenceHash", "type": "bytes32"}],
     "name": "openBehaviorIncident", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "finalizeIncident",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "triggerReconfiguration",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_formationMode", "type": "uint8"}], "name": "setFormation",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "recoverToActiveReconfigured",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "taskId", "type": "uint256"}], "name": "completeTask",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "completeMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "reason", "type": "string"}], "name": "abortMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "resetMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "heartbeat",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "vote", "type": "uint8"}], "name": "voteOnSuspect",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
]

FULL_FORMATION_ABI = [
    {"inputs": [{"name": "_uav", "type": "address"}, {"name": "_x", "type": "int256"}, {"name": "_y", "type": "int256"}],
     "name": "registerUAV", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "startMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_formationId", "type": "uint256"}, {"name": "_dMinSq", "type": "uint256"},
                {"name": "_dMaxSq", "type": "uint256"}, {"name": "_rMaxSq", "type": "uint256"}],
     "name": "changeFormation", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "finalizeFormationChange",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_dMinSq", "type": "uint256"}, {"name": "_dMaxSq", "type": "uint256"}, {"name": "_rMaxSq", "type": "uint256"}],
     "name": "updateFormationConstraints", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "checkLateUAVs",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_uav", "type": "address"}], "name": "deactivateUAV",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "completeMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "reason", "type": "string"}], "name": "abortMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [], "name": "resetMission",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_x", "type": "int256"}, {"name": "_y", "type": "int256"}],
     "name": "updatePosition", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_violator", "type": "address"}], "name": "reportViolation",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"inputs": [{"name": "_uav", "type": "address"}], "name": "reportRecovery",
     "outputs": [], "stateMutability": "nonpayable", "type": "function"},
]
