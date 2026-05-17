import { useEffect, useState } from 'react';
import { discourseUser, discourseOAuthUrl, discourseLatest, discourseDisconnect, type DiscourseUser, type DiscoursePost } from '../lib/transport';

export function DiscoursePanel() {
  const [user, setUser] = useState<DiscourseUser | null>(null);
  const [posts, setPosts] = useState<DiscoursePost[]>([]);

  useEffect(() => {
    discourseUser().then((u) => {
      setUser(u);
      if (u) discourseLatest(10).then(setPosts);
    });
  }, []);

  const handleConnect = async () => {
    const url = await discourseOAuthUrl();
    // Open in system browser for OAuth flow
    window.open(url, '_blank');
  };

  const handleDisconnect = async () => {
    await discourseDisconnect();
    setUser(null);
    setPosts([]);
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <h2 style={{ fontFamily: 'var(--ew-font-display)', fontSize: 22, marginBottom: 16 }}>
        Community
      </h2>

      <div className="ew-section">
        <div className="ew-section__title">Discourse Forum</div>
        {user ? (
          <>
            <div className="ew-discourse__status">
              <div className="ew-discourse__connected">
                Connected as @{user.username}
              </div>
              {user.unread_notifications > 0 && (
                <span style={{
                  background: 'var(--ew-danger)',
                  color: 'white',
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 10,
                  fontWeight: 600,
                }}>
                  {user.unread_notifications}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              <button
                className="ew-btn ew-btn--ghost"
                onClick={() => window.open('https://forum.strandsnation.xyz', '_blank')}
              >
                Open Forum
              </button>
              <button className="ew-btn ew-btn--danger" onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <div>
            <p style={{ fontSize: 14, color: 'var(--ew-text-muted)', marginBottom: 16, lineHeight: 1.6 }}>
              Connect to the Strands Nation community forum. Access discussions,
              announcements, and support from within Everywear OS.
            </p>
            <button className="ew-btn" onClick={handleConnect}>
              Connect Discourse
            </button>
          </div>
        )}
      </div>

      {user && (
        <div className="ew-section">
          <div className="ew-section__title">Latest Posts</div>
          {posts.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--ew-text-faint)' }}>No recent posts</p>
          ) : (
            posts.map((post) => (
              <div
                key={post.id}
                style={{
                  padding: '12px 0',
                  borderBottom: '1px solid var(--ew-border)',
                  cursor: 'pointer',
                }}
                onClick={() => window.open(post.topic_url, '_blank')}
              >
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
                  {post.topic_title}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ew-text-muted)' }}>
                  {post.author} &middot; {post.category}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
