import { useEffect, useState } from 'react';
import { walletInfo, walletGenerate, walletDisconnect, walletTransactions, type WalletInfo, type Transaction } from '../lib/transport';

export function WalletPanel() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    walletInfo().then((w) => {
      setWallet(w);
      if (w?.connected) walletTransactions(10).then(setTxns);
    });
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const w = await walletGenerate();
      setWallet(w);
    } finally {
      setGenerating(false);
    }
  };

  const handleDisconnect = async () => {
    await walletDisconnect();
    setWallet(null);
    setTxns([]);
  };

  if (!wallet || !wallet.connected) {
    return (
      <div className="ew-wallet-panel">
        <h2 style={{ fontFamily: 'var(--ew-font-display)', fontSize: 22, marginBottom: 16 }}>
          Strands Chain Wallet
        </h2>
        <div className="ew-section">
          <div className="ew-section__title">Connect Wallet</div>
          <p style={{ fontSize: 14, color: 'var(--ew-text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
            Generate a new Strands Chain keypair to connect to the ecosystem.
            Your private key stays on this device and is never transmitted.
          </p>
          <button className="ew-btn" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating...' : 'Generate Wallet'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ew-wallet-panel">
      <h2 style={{ fontFamily: 'var(--ew-font-display)', fontSize: 22, marginBottom: 16 }}>
        Strands Chain Wallet
      </h2>

      <div className="ew-section">
        <div className="ew-section__title">Address</div>
        <div className="ew-wallet__address">{wallet.address}</div>
        <div className="ew-wallet__chain-badge">
          {wallet.network}
        </div>
      </div>

      <div className="ew-section">
        <div className="ew-section__title">Balance</div>
        <div className="ew-wallet__balance-row">
          <span className="ew-wallet__balance-label">STRANDS</span>
          <span className="ew-wallet__balance-value">
            {wallet.balance.strands.toLocaleString()}
          </span>
        </div>
        <div className="ew-wallet__balance-row">
          <span className="ew-wallet__balance-label">Founders Pass</span>
          <span className="ew-wallet__balance-value">
            {wallet.balance.founders_passes}
          </span>
        </div>
        {wallet.balance.tokens.map((tok) => (
          <div key={tok.symbol} className="ew-wallet__balance-row">
            <span className="ew-wallet__balance-label">{tok.name}</span>
            <span className="ew-wallet__balance-value">
              {tok.amount.toLocaleString()} {tok.symbol}
            </span>
          </div>
        ))}
      </div>

      <div className="ew-section">
        <div className="ew-section__title">Recent Transactions</div>
        {txns.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--ew-text-faint)' }}>No transactions yet</p>
        ) : (
          txns.map((tx) => (
            <div key={tx.hash} style={{ padding: '8px 0', borderBottom: '1px solid var(--ew-border)' }}>
              <div style={{ fontFamily: 'var(--ew-font-mono)', fontSize: 12 }}>
                {tx.hash.slice(0, 16)}...
              </div>
              <div style={{ fontSize: 12, color: 'var(--ew-text-muted)' }}>
                {tx.amount} {tx.token} &middot; {tx.status}
              </div>
            </div>
          ))
        )}
      </div>

      <button className="ew-btn ew-btn--danger" onClick={handleDisconnect}>
        Disconnect Wallet
      </button>
    </div>
  );
}
