import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Block, Entry, BlockDistribution, MetaRaffleState 
} from './types';
import { 
  ENTRY_COST, MAX_POT_SIZE, 
  MAX_BLOCK_DURATION_MS, WINNER_PCT, HOUSE_PCT, SPREAD_PCT, 
  TOP_CONTRIBUTORS_COUNT, META_RAFFLE_THRESHOLD 
} from './constants';
import { BlockCard } from './components/BlockCard';
import { MetaRaffleStats } from './components/MetaRaffleStats';
import { HistoryLog } from './components/HistoryLog';
import { generateBlockCommentary } from './services/geminiService';
import { Wallet, Info, Activity, AlertCircle } from 'lucide-react';

const Logo = () => (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="transform hover:scale-105 transition-transform duration-300">
    <defs>
      <linearGradient id="logo_grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#00f3ff" />
        <stop offset="100%" stopColor="#bc13fe" />
      </linearGradient>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>
    
    {/* Outer Hexagon/Block shape with Glow */}
    <path d="M20 2 L36 11 V29 L20 38 L4 29 V11 Z" fill="url(#logo_grad)" stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
    
    {/* Inner Cube Top */}
    <path d="M20 12 L28 16 L20 20 L12 16 Z" fill="#050b14" opacity="0.8"/>
    
    {/* Inner Cube Sides */}
    <path d="M12 16 V25 L20 29 V20" fill="#050b14" opacity="0.6"/>
    <path d="M28 16 V25 L20 29 V20" fill="#050b14" opacity="0.4"/>
    
    {/* Neon Lines */}
    <path d="M20 20 V29" stroke="#00f3ff" strokeWidth="2" strokeLinecap="round" />
    <path d="M12 16 L20 20 L28 16" stroke="#bc13fe" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Add global type for window.ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}

const App: React.FC = () => {
  // --- STATE ---
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [activeBlock, setActiveBlock] = useState<Block | null>(null);
  const [completedBlocks, setCompletedBlocks] = useState<Block[]>([]);
  
  // Wallet State
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [userBalance, setUserBalance] = useState(0); 
  const [isProcessingTx, setIsProcessingTx] = useState(false);
  
  const [metaState, setMetaState] = useState<MetaRaffleState>({
    blocksCompleted: 0,
    topContributors: new Map()
  });
  
  // Refs for processing loops to avoid dependency cycles
  const activeBlockRef = useRef<Block | null>(null);
  const metaStateRef = useRef<MetaRaffleState>(metaState);

  // Sync refs with state
  useEffect(() => { activeBlockRef.current = activeBlock; }, [activeBlock]);
  useEffect(() => { metaStateRef.current = metaState; }, [metaState]);

  // --- LOGIC: WALLET CONNECTION ---
  const connectWallet = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        if (accounts.length > 0) {
          setWalletAddress(accounts[0]);
          // Simulate fetching balance from chain - giving user a "Testnet Facuet" balance
          setUserBalance(5000); 
        }
      } catch (error) {
        console.error("User rejected connection", error);
      }
    } else {
      alert("Please install MetaMask or a compatible wallet to use RaffleCaster.");
    }
  };

  const shortenAddress = (addr: string) => {
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  // --- LOGIC: CREATE BLOCK ---
  const createNewBlock = useCallback((id: number): Block => {
    return {
      id,
      startTime: Date.now(),
      endTime: null,
      entries: [],
      status: 'active',
      totalPot: 0,
      winnerId: null,
      distribution: null
    };
  }, []);

  // Initialize first block if none
  useEffect(() => {
    if (!activeBlock) {
      setActiveBlock(createNewBlock(1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- LOGIC: CLOSE BLOCK & DISTRIBUTE ---
  const closeBlock = async (block: Block) => {
    // 1. Set status processing
    setActiveBlock(prev => prev ? { ...prev, status: 'processing' } : null);
    
    // 2. Determine Winner
    // In a real app, this uses Chainlink VRF.
    const totalEntries = block.entries.length;
    let winnerId = 'HOUSE'; // Default if empty
    let distribution: BlockDistribution = { winnerAmount: 0, houseAmount: 0, spreadAmount: 0, spreadRecipients: [] };

    if (totalEntries > 0) {
      // Secure randomness placeholder
      const winnerIndex = Math.floor(Math.random() * totalEntries);
      winnerId = block.entries[winnerIndex].userId;

      // 3. Calculate Math
      const totalPot = block.totalPot;
      const winnerAmount = totalPot * WINNER_PCT;
      const houseAmount = totalPot * HOUSE_PCT;
      const spreadTotal = totalPot * SPREAD_PCT;

      // Spread Logic: Top 20 contributors to THIS block
      const contribs = new Map<string, number>();
      block.entries.forEach(e => {
        contribs.set(e.userId, (contribs.get(e.userId) || 0) + e.amount);
      });
      
      const sortedContribs = Array.from(contribs.entries())
        .sort((a, b) => b[1] - a[1]) // Descending
        .slice(0, TOP_CONTRIBUTORS_COUNT);
        
      const totalTopContribAmount = sortedContribs.reduce((sum, [, amt]) => sum + amt, 0);

      const spreadRecipients = sortedContribs.map(([uid, amt]) => ({
        userId: uid,
        amount: (amt / totalTopContribAmount) * spreadTotal
      }));

      distribution = {
        winnerAmount,
        houseAmount,
        spreadAmount: spreadTotal,
        spreadRecipients
      };

      // 4. Update Balance if User Won or in Spread (Local Simulation of Chain State update)
      if (walletAddress && winnerId.toLowerCase() === walletAddress.toLowerCase()) {
        setUserBalance(prev => prev + winnerAmount);
      }
      const mySpread = walletAddress ? spreadRecipients.find(s => s.userId.toLowerCase() === walletAddress.toLowerCase()) : null;
      if (mySpread) {
        setUserBalance(prev => prev + mySpread.amount);
      }
    }

    const finalBlock: Block = {
      ...block,
      endTime: Date.now(),
      status: 'completed',
      winnerId,
      distribution
    };

    // 5. AI Commentary
    const commentary = await generateBlockCommentary(finalBlock);
    finalBlock.aiCommentary = commentary;

    // 6. Update Meta State
    const newContributorsMap = new Map<string, number>(metaStateRef.current.topContributors);
    block.entries.forEach(e => {
      newContributorsMap.set(e.userId, (newContributorsMap.get(e.userId) || 0) + e.amount);
    });

    // Check Meta Raffle Trigger
    const nextBlockCount = metaStateRef.current.blocksCompleted + 1;
    if (nextBlockCount % META_RAFFLE_THRESHOLD === 0) {
      console.log("META RAFFLE TRIGGERED - RESETTING COUNTS");
      newContributorsMap.clear();
    }

    setMetaState({
      blocksCompleted: nextBlockCount,
      topContributors: newContributorsMap
    });

    setCompletedBlocks(prev => [finalBlock, ...prev]);
    setActiveBlock(createNewBlock(finalBlock.id + 1));
  };

  // --- LOGIC: GAME LOOP ---
  // Only handles time-expiry checks now. No more bots.
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setCurrentTime(now);

      const currentBlock = activeBlockRef.current;
      if (!currentBlock || currentBlock.status !== 'active') return;

      // Check Timers & Pot Limits
      const isTimeExpired = (now - currentBlock.startTime) >= MAX_BLOCK_DURATION_MS;
      const isPotFull = currentBlock.totalPot >= MAX_POT_SIZE;

      // Only close if there are entries OR time forced close
      if ((isTimeExpired && currentBlock.entries.length > 0) || isPotFull) {
        closeBlock(currentBlock);
      } else if (isTimeExpired && currentBlock.entries.length === 0) {
        // If time expired and no entries, just reset start time to keep block alive (or we could close with no winner)
        // Let's restart the timer for UX purposes so it doesn't look broken
        setActiveBlock(prev => prev ? { ...prev, startTime: now } : null);
      }

    }, 1000); // 1s tick

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]); // Re-bind if wallet changes

  // --- HANDLER: USER ENTRY ---
  const handleEntry = async (amount: number) => {
    if (!activeBlock || !walletAddress || userBalance < amount) return;
    
    setIsProcessingTx(true);

    // Simulate Network Request Delay
    setTimeout(() => {
      // Optimistic Update
      setUserBalance(prev => prev - amount);
      
      const entry: Entry = {
        id: crypto.randomUUID(),
        userId: walletAddress,
        username: shortenAddress(walletAddress),
        timestamp: Date.now(),
        amount: amount
      };

      setActiveBlock(prev => {
        if (!prev) return null;
        return {
          ...prev,
          entries: [...prev.entries, entry],
          totalPot: prev.totalPot + amount
        };
      });
      
      setIsProcessingTx(false);
    }, 2000); // 2 second mock confirmation time
  };

  return (
    <div className="min-h-screen bg-deep-space text-slate-200 font-sans selection:bg-neon-purple selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-deep-space/80 backdrop-blur-md border-b border-white/1