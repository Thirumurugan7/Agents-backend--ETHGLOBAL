import { encodeFunctionData } from "viem";
import "dotenv/config";
import { toSafeSmartAccount } from "permissionless/accounts";
import { createPublicClient, getContract, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia, baseSepolia, base, polygonAmoy } from "viem/chains";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createBundlerClient, entryPoint07Address } from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { keccak256, toBytes, decodeEventLog } from "viem";
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ethers } from "ethers";

// Get current file's directory
const __dirname = dirname(fileURLToPath(import.meta.url));

// Read and parse the JSON file
const abiToken = JSON.parse(
  readFileSync(join(__dirname, './abi.json'), 'utf8')
);

export const sbtmint = async (req, res) => {
  const { to } = req.body;

  if (!to) {
    return res.status(400).json({ message: "Wallet address is required" });
  }


  // If no existing token found, proceed with minting...
  const abi = [
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "user",
          "type": "address"
        },
        {
          "internalType": "uint256",
          "name": "points",
          "type": "uint256"
        }
      ],
      "name": "addPoints",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    }
  ];

  const apiKey = process.env.PIMLICO_API_KEY;
  if (!apiKey) throw new Error("Missing PIMLICO_API_KEY");

  const privateKey = process.env.PRIVATE_KEY;
  const contractAddress = "0x438b8336B6C4104d653F783714197d9C14fe17FD";

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.INFURA_URL),
  });

  const pimlicoUrl = `https://api.pimlico.io/v2/84532/rpc?apikey=${process.env.PIMLICO_API_KEY}`;

  const pimlicoClient = createPimlicoClient({
    transport: http(pimlicoUrl),
    entryPoint: { address: entryPoint07Address, version: "0.7" },
  });

  const account = await toSafeSmartAccount({
    client: publicClient,
    owners: [privateKeyToAccount(privateKey)],
    entryPoint: { address: entryPoint07Address, version: "0.7" },
    version: "1.4.1",
  });

  console.log(
    `Smart account address: https://sepolia.basescan.io/address/${account.address}`
  );

  const smartAccountClient = createSmartAccountClient({
    account,
    chain: baseSepolia,
    bundlerTransport: http(pimlicoUrl),
    paymaster: pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () => {
        return (await pimlicoClient.getUserOperationGasPrice()).fast;
      },
    },
  });

  // Add this check before the transaction
  const balance = await publicClient.getBalance({
    address: account.address,
  });

  const requiredAmount = ethers.utils.parseEther("0.02"); // 0.01 for fee + buffer for gas
  if (balance < requiredAmount) {
    return res.status(400).json({
      success: false,
      message: "Insufficient funds in smart account",
      details: {
        accountAddress: account.address,
        currentBalance: ethers.utils.formatEther(balance),
        requiredBalance: "0.02 MATIC",
      }
    });
  }

  // 🔹 **Send Transaction**
  const txHash = await smartAccountClient.sendTransaction({
    to: contractAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: abi,
      functionName: "addPoints",
      args: [
        to,
       "100"
      ],
    }),
  });

  console.log(`Transaction sent: https://sepolia.basescan.org/tx/${txHash}`);

  // 🔹 **Wait for transaction confirmation**
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (!receipt) {
    return res.status(500).json({ message: "Transaction not confirmed" });
  }
  console.log(receipt);



  return res.status(200).json({
    success: true,
    message: "Minted status updated",
    transactionHash: receipt.transactionHash,
  });
};

export const reclaimSBT = async (req, res) => {
  try {
    const { address } = req.query; // Changed from req.params to req.query
    console.log(address);

    if (!address) {
      return res.status(400).json({ message: "Wallet address is required" });
    }

    // Setup contract interaction
    const abi = [
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "user",
            "type": "address"
          }
        ],
        "name": "getPoints",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      }
    ];

    const contractAddress = "0x438b8336B6C4104d653F783714197d9C14fe17FD";

    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(process.env.INFURA_URL),
    });

    // Create contract instance with proper configuration
    const contract = {
      address: contractAddress,
      abi,
      publicClient,
    };

    // Call getPoints function using the publicClient directly
    const points = await publicClient.readContract({
      ...contract,
      functionName: 'getPoints',
      args: [address],
    });

    return res.status(200).json({
      success: true,
      message: "Points retrieved successfully", 
      points: points.toString(),
      address: address
    });

  } catch (error) {
    console.error("Error getting points:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get points",
      error: error.message,
    });
  }
};

export const createToken = async (req, res) => {
  try {
    const { 
      name,
      symbol,
      initialSupply,
      maxSupply,
      initialPrice,
      creatorLockupPeriod,
      lockLiquidity,
      liquidityLockPeriod,
      userAddress
    } = req.body;

    console.log("Request body:", req.body);

    // Validate inputs
    if (!userAddress) {
      return res.status(400).json({ message: "User address is required" });
    }

    // Setup Pimlico clients
    const apiKey = process.env.PIMLICO_API_KEY;
    if (!apiKey) throw new Error("Missing PIMLICO_API_KEY");

    const privateKey = process.env.PRIVATE_KEY;
    const contractAddress = process.env.FACTORY_CONTRACT_ADDRESS;

    console.log("Contract Address:", contractAddress);

    const publicClient = createPublicClient({
      chain: polygonAmoy,
      transport: http(process.env.INFURA_URL),
    });

    const pimlicoUrl = `https://api.pimlico.io/v2/80002/rpc?apikey=pim_UACBBfefRXFdpheZCcB6VV`;

    const pimlicoClient = createPimlicoClient({
      transport: http(pimlicoUrl),
      entryPoint: { address: entryPoint07Address, version: "0.7" },
    });

    const account = await toSafeSmartAccount({
      client: publicClient,
      owners: [privateKeyToAccount(privateKey)],
      entryPoint: { address: entryPoint07Address, version: "0.7" },
      version: "1.4.1",
    });

    console.log("Smart Account Address:", account.address);

    const smartAccountClient = createSmartAccountClient({
      account,
      chain: polygonAmoy,
      bundlerTransport: http(pimlicoUrl),
      paymaster: pimlicoClient,
      userOperation: {
        estimateFeesPerGas: async () => {
          return (await pimlicoClient.getUserOperationGasPrice()).fast;
        },
      },
    });

    const initialPriceWei = ethers.utils.parseEther(initialPrice);

    // Create token with user as creator
    const createTokenData = encodeFunctionData({
      abi: abiToken,
      functionName: "createToken",
      args: [
        userAddress,
        name,
        symbol,
        initialSupply,
        maxSupply,
        initialPriceWei,
        creatorLockupPeriod,
        lockLiquidity,
        liquidityLockPeriod
      ],
    });

    const CREATION_FEE = "0.01"; // Fixed creation fee
    const creationFeeWei = ethers.utils.parseEther(CREATION_FEE);

    // Get gas price from Pimlico client
    const gasPrice = await pimlicoClient.getUserOperationGasPrice();
    console.log("Pimlico Gas Price:", gasPrice);

    // Skip gas estimation since it's failing
    const txHash = await smartAccountClient.sendTransaction({
      to: contractAddress,
      value: creationFeeWei,
      data: createTokenData,
      gas: BigInt(1000000), // Fixed gas limit
      maxFeePerGas: gasPrice.fast.maxFeePerGas,        // Use fast tier
      maxPriorityFeePerGas: gasPrice.fast.maxPriorityFeePerGas,  // Use fast tier
      paymasterParams: {
        paymaster: "0x0000000000000039cd5e8aE05257CE51C473ddd1",
        paymasterVerificationGasLimit: 150000,
        paymasterPostOpGasLimit: 50000,
        paymasterData: "0x"
      },
      preVerificationGas: 100000,
      verificationGasLimit: 500000,
      callGasLimit: BigInt(1000000)
    });

    console.log("Token Creation Hash:", txHash);

    // Wait for token creation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 3,
      timeout: 60_000
    });

    // Get the new token address from the event
    const tokenCreatedEvent = receipt.logs.find(log => 
      log.topics[0] === keccak256(toBytes("TokenCreated(address,address,string,string)"))
    );

    if (!tokenCreatedEvent) {
      throw new Error("Token creation event not found in logs");
    }

    const tokenAddress = `0x${tokenCreatedEvent.topics[1].slice(26)}`;
    console.log("New Token Address:", tokenAddress);

    return res.status(200).json({
      success: true,
      message: "Token created successfully",
      tokenAddress,
      creationTx: txHash,
      creator: userAddress
    });

  } catch (error) {
    console.error("Detailed error:", {
      message: error.message,
      cause: error.cause?.message,
      details: error.details,
    });
    
    return res.status(500).json({
      success: false,
      message: "Failed to create token",
      error: error.message,
      details: error.details
    });
  }
};

export const sellTokens = async (req, res) => {
  try {
    const { tokenAddress, tokenAmount } = req.body;
    const { userAddress } = req.body;

    // Encode the sell tokens call
    const sellTokenData = encodeFunctionData({
      abi: erc20ABI,  // imported from erc20.json
      functionName: "sellTokens",
      args: [
        userAddress,
        tokenAmount
      ],
    });

    // Get gas price from Pimlico client
    const gasPrice = await pimlicoClient.getUserOperationGasPrice();
    console.log("Pimlico Gas Price:", gasPrice);

    const txHash = await smartAccountClient.sendTransaction({
      to: tokenAddress,
      data: sellTokenData,
      gas: BigInt(1000000),
      maxFeePerGas: gasPrice.fast.maxFeePerGas,
      maxPriorityFeePerGas: gasPrice.fast.maxPriorityFeePerGas,
      paymasterParams: {
        paymaster: "0x0000000000000039cd5e8aE05257CE51C473ddd1",
        paymasterVerificationGasLimit: 150000,
        paymasterPostOpGasLimit: 50000,
        paymasterData: "0x"
      },
      preVerificationGas: 100000,
      verificationGasLimit: 500000,
      callGasLimit: BigInt(1000000)
    });

    console.log("Sell Transaction Hash:", txHash);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 3,
      timeout: 60_000
    });

    return res.status(200).json({
      success: true,
      message: "Tokens sold successfully",
      transactionHash: txHash,
      receipt
    });

  } catch (error) {
    console.error("Error selling tokens:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to sell tokens",
      error: error.message,
      details: error.details
    });
  }
};

export const buyTokens = async (req, res) => {
  try {
    const { tokenAddress, desiredTokenAmount, ethAmount } = req.body;
    const { userAddress } = req.body;

    // Encode the buy tokens call
    const buyTokenData = encodeFunctionData({
      abi: erc20ABI,  // imported from erc20.json
      functionName: "buyTokens",
      args: [
        userAddress,
        desiredTokenAmount
      ],
    });

    // Get gas price from Pimlico client
    const gasPrice = await pimlicoClient.getUserOperationGasPrice();
    console.log("Pimlico Gas Price:", gasPrice);

    const txHash = await smartAccountClient.sendTransaction({
      to: tokenAddress,
      value: ethAmount, // ETH amount to send for purchase
      data: buyTokenData,
      gas: BigInt(1000000),
      maxFeePerGas: gasPrice.fast.maxFeePerGas,
      maxPriorityFeePerGas: gasPrice.fast.maxPriorityFeePerGas,
      paymasterParams: {
        paymaster: "0x0000000000000039cd5e8aE05257CE51C473ddd1",
        paymasterVerificationGasLimit: 150000,
        paymasterPostOpGasLimit: 50000,
        paymasterData: "0x"
      },
      preVerificationGas: 100000,
      verificationGasLimit: 500000,
      callGasLimit: BigInt(1000000)
    });

    console.log("Buy Transaction Hash:", txHash);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      confirmations: 3,
      timeout: 60_000
    });

    return res.status(200).json({
      success: true,
      message: "Tokens purchased successfully",
      transactionHash: txHash,
      receipt
    });

  } catch (error) {
    console.error("Error buying tokens:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to buy tokens",
      error: error.message,
      details: error.details
    });
  }
};


