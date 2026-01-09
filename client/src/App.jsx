import { useEffect, useMemo, useState } from 'react';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || '';

const fetchJson = async (url, options, token) => {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options?.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Request failed');
  }
  return res.json();
};

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('token') || '');
  const [items, setItems] = useState([]);
  const [available, setAvailable] = useState([]);
  const [categories, setCategories] = useState([]);
  const [expiring, setExpiring] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [groupItems, setGroupItems] = useState([]);
  const [ownerClaims, setOwnerClaims] = useState([]);
  const [myClaims, setMyClaims] = useState([]);
  const [shareLink, setShareLink] = useState('');
  const [error, setError] = useState('');
  const [groupMessages, setGroupMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');

  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [newItem, setNewItem] = useState({ title: '', categoryId: '', expiresAt: '' });
  const [newGroup, setNewGroup] = useState({ name: '' });
  const [newMember, setNewMember] = useState({ userId: '', tag: '', groupId: '' });
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState([]);
  const [newClaim, setNewClaim] = useState({ itemId: '' });
  const [loading, setLoading] = useState(false);
  const inviteBase = typeof window !== 'undefined' ? window.location.origin : '';

  const availableItems = useMemo(() => available, [available]);

  const loadAll = async (activeToken = token) => {
    setLoading(true);
    try {
      const [cats, it, exp, grp, avail, ownerCls, myCls] = await Promise.all([
        fetchJson(`${API_BASE}/api/categories`, {}, activeToken),
        fetchJson(`${API_BASE}/api/items`, {}, activeToken),
        fetchJson(`${API_BASE}/api/items/expiring`, {}, activeToken),
        fetchJson(`${API_BASE}/api/groups`, {}, activeToken),
        fetchJson(`${API_BASE}/api/items/available`, {}, activeToken),
        fetchJson(`${API_BASE}/api/claims/for-owner`, {}, activeToken),
        fetchJson(`${API_BASE}/api/claims/mine`, {}, activeToken),
      ]);
      setCategories(cats);
      setItems(it);
      setExpiring(exp);
      setGroups(grp);
      setAvailable(avail);
      setOwnerClaims(ownerCls);
      setMyClaims(myCls);
      setError('');
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const bootstrap = async (activeToken) => {
    if (!activeToken) return;
    try {
      const me = await fetchJson(`${API_BASE}/api/me`, {}, activeToken);
      setUser(me);
      await loadAll(activeToken);
    } catch (err) {
      console.error(err);
      setError(err.message);
      setUser(null);
      setToken('');
      localStorage.removeItem('token');
    }
  };

  useEffect(() => {
    bootstrap(token);
  }, [token]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    const { name, email, password } = authForm;
    if (!email || !password || (authMode === 'register' && !name)) {
      return setError('Completează câmpurile.');
    }
    try {
      const res = await fetchJson(`${API_BASE}/api/auth/${authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authMode === 'login' ? { email, password } : { name, email, password }),
      });
      setToken(res.token);
      localStorage.setItem('token', res.token);
      setUser(res.user);
      setAuthForm({ name: '', email: '', password: '' });
      await loadAll(res.token);
    } catch (err) {
      setError(err.message);
    }
  };

  const logout = () => {
    setUser(null);
    setToken('');
    localStorage.removeItem('token');
  };

  const submitItem = async (e) => {
    e.preventDefault();
    setError('');
    if (!newItem.title) return setError('Adaugă un titlu.');
    try {
      await fetchJson(`${API_BASE}/api/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newItem.title,
          categoryId: newItem.categoryId ? Number(newItem.categoryId) : undefined,
          expiresAt: newItem.expiresAt || undefined,
        }),
      }, token);
      setNewItem({ title: '', categoryId: '', expiresAt: '' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const markAvailable = async (id) => {
    try {
      await fetchJson(`${API_BASE}/api/items/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'AVAILABLE' }),
      }, token);
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const searchUsers = async (value) => {
    setMemberSearch(value);
    setNewMember((prev) => ({ ...prev, userId: '' }));
    if (!value.trim() || value.trim().length < 2) {
      setMemberResults([]);
      return;
    }
    try {
      const results = await fetchJson(
        `${API_BASE}/api/users/search?q=${encodeURIComponent(value.trim())}`,
        {},
        token
      );
      setMemberResults(results);
    } catch (err) {
      setError(err.message);
    }
  };

  const addGroup = async (e) => {
    e.preventDefault();
    if (!newGroup.name) return setError('Nume grup necesar.');
    try {
      await fetchJson(`${API_BASE}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGroup.name }),
      }, token);
      setNewGroup({ name: '' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const addMember = async (e) => {
    e.preventDefault();
    if (!newMember.userId || !newMember.groupId) {
      return setError('Alege grup și un utilizator existent.');
    }
    try {
      await fetchJson(`${API_BASE}/api/groups/${newMember.groupId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: Number(newMember.userId),
          tag: newMember.tag,
        }),
      }, token);
      setNewMember({ userId: '', tag: '', groupId: '' });
      setMemberSearch('');
      setMemberResults([]);
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const loadGroupItems = async (groupId) => {
    if (!groupId) return;
    try {
      const data = await fetchJson(`${API_BASE}/api/groups/${groupId}/items`, {}, token);
      setGroupItems(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const loadGroupMessages = async (groupId) => {
    if (!groupId) return;
    try {
      const data = await fetchJson(`${API_BASE}/api/groups/${groupId}/messages`, {}, token);
      setGroupMessages(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const selectGroup = async (groupId) => {
    setSelectedGroup(groupId);
    setGroupItems([]);
    setGroupMessages([]);
    if (!groupId) return;
    await Promise.all([loadGroupItems(groupId), loadGroupMessages(groupId)]);
  };

  const shareToGroup = async (e) => {
    e.preventDefault();
    if (!selectedGroup || !newClaim.itemId) {
      return setError('Alege grup și produs de trimis.');
    }
    try {
      await fetchJson(`${API_BASE}/api/groups/${selectedGroup}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: Number(newClaim.itemId) }),
      }, token);
      await loadGroupItems(selectedGroup);
    } catch (err) {
      setError(err.message);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!selectedGroup || !newMessage.trim()) return;
    try {
      await fetchJson(`${API_BASE}/api/groups/${selectedGroup}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newMessage }),
      }, token);
      setNewMessage('');
      await loadGroupMessages(selectedGroup);
    } catch (err) {
      setError(err.message);
    }
  };

  const createClaim = async (e) => {
    e.preventDefault();
    if (!newClaim.itemId) {
      return setError('Selectează produs.');
    }
    try {
      await fetchJson(`${API_BASE}/api/claims`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: Number(newClaim.itemId),
        }),
      }, token);
      setNewClaim({ itemId: '' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const decideClaim = async (id, decision) => {
    try {
      await fetchJson(`${API_BASE}/api/claims/${id}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      }, token);
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const shareItem = async (itemId, network) => {
    try {
      const res = await fetchJson(`${API_BASE}/api/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, network }),
      }, token);
      setShareLink(res.shareUrl);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Food Waste Tracker</p>
          <h1>Conectăm surplusul cu nevoia</h1>
          <p className="lede">
            Listează ce ai în frigider, primește alerte la expirare, marchează disponibil și lasă
            prietenii să revendice produsele.
          </p>
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}
      {loading && <div className="alert muted">Se încarcă...</div>}

      {!user && (
        <main className="content grid-2">
          <section className="panel">
            <h2>{authMode === 'login' ? 'Autentificare' : 'Creare cont'}</h2>
            <form className="form" onSubmit={handleAuth}>
              {authMode === 'register' && (
                <label>
                  <span>Nume</span>
                  <input
                    value={authForm.name}
                    onChange={(e) => setAuthForm({ ...authForm, name: e.target.value })}
                  />
                </label>
              )}
              <label>
                <span>Email</span>
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                />
              </label>
              <label>
                <span>Parolă</span>
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                />
              </label>
              <button type="submit">{authMode === 'login' ? 'Login' : 'Înregistrează-te'}</button>
              <button
                type="button"
                className="ghost"
                onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
              >
                {authMode === 'login' ? 'Nu ai cont? Înregistrează-te' : 'Ai cont? Login'}
              </button>
            </form>
          </section>
        </main>
      )}

      {!user ? (
        <div className="content">
          <div className="panel">
            <p className="muted">Autentifică-te pentru a accesa datele.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="content">
            <div className="panel">
              <div className="muted">Autentificat ca {user.name} ({user.email})</div>
              <button type="button" onClick={logout}>
                Logout
              </button>
            </div>
          </div>
          <main className="content grid-3">
            <section className="panel">
              <h2>Frigiderul meu</h2>
              <form className="form" onSubmit={submitItem}>
                <label>
                  <span>Produs</span>
                  <input
                    value={newItem.title}
                    onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                    placeholder="Ex: Lapte"
                  />
                </label>
                <label>
                  <span>Categorie</span>
                  <select
                    value={newItem.categoryId}
                    onChange={(e) => setNewItem({ ...newItem, categoryId: e.target.value })}
                  >
                    <option value="">Fără categorie</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Expiră la</span>
                  <input
                    type="date"
                    value={newItem.expiresAt}
                    onChange={(e) => setNewItem({ ...newItem, expiresAt: e.target.value })}
                  />
                </label>
                <button type="submit">Adaugă</button>
              </form>

              <ul className="list">
                {items.map((i) => (
                  <li key={i.id} className="list-item">
                    <div className="item-title">{i.title}</div>
                    <div className="item-meta">
                      <span>{i.category?.name || 'Fără categorie'}</span>
                      <span>•</span>
                      <span>{i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : 'n/a'}</span>
                      <span>•</span>
                      <span>Status: {i.status}</span>
                    </div>
                    {i.status === 'IN_FRIDGE' && (
                      <button className="ghost" onClick={() => markAvailable(i.id)}>
                        Marchează disponibil
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel">
              <h2>Alerte expirare</h2>
              {expiring.length === 0 ? (
                <p className="muted">Nimic nu expiră curând.</p>
              ) : (
                <ul className="list">
                  {expiring.map((i) => (
                    <li key={i.id} className="list-item">
                      <div className="item-title">{i.title}</div>
                      <div className="item-meta">
                        <span>Expiră: {i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : 'n/a'}</span>
                      </div>
                      <button className="ghost" onClick={() => markAvailable(i.id)}>
                        Fă disponibil
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <h3 style={{ marginTop: '16px' }}>Claim-uri pe produsele mele</h3>
              {ownerClaims.length === 0 ? (
                <p className="muted">Nu există claim-uri încă.</p>
              ) : (
                <ul className="list">
                  {ownerClaims.map((c) => (
                    <li key={c.id} className="list-item">
                      <div className="item-title">{c.item?.title || `Produs #${c.itemId}`}</div>
                      <div className="item-meta">Solicitant: {c.claimer?.name}</div>
                      <div className="actions">
                        <button onClick={() => decideClaim(c.id, 'ACCEPTED')}>Acceptă</button>
                        <button className="ghost" onClick={() => decideClaim(c.id, 'REJECTED')}>
                          Respinge
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <h2>Grupuri & prieteni</h2>
              <form className="form" onSubmit={addGroup}>
                <label>
                  <span>Nume grup</span>
                  <input
                    value={newGroup.name}
                    onChange={(e) => setNewGroup({ name: e.target.value })}
                    placeholder="Ex: Vecini bloc B"
                  />
                </label>
                <button type="submit">Creează grup</button>
              </form>

              <form className="form" onSubmit={addMember}>
                <label>
                  <span>Grup</span>
                  <select
                    value={newMember.groupId}
                    onChange={(e) => setNewMember({ ...newMember, groupId: e.target.value })}
                  >
                    <option value="">Alege grup</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Caută utilizator (minim 2 caractere)</span>
                  <input
                    value={memberSearch}
                    onChange={(e) => searchUsers(e.target.value)}
                    placeholder="Ex: Ana"
                  />
                </label>
                {memberResults.length > 0 && (
                  <div className="list" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                    {memberResults.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className="list-item"
                        onClick={() => {
                          setNewMember({ ...newMember, userId: String(u.id) });
                          setMemberSearch(u.name);
                        }}
                        style={{
                          textAlign: 'left',
                          background: newMember.userId === String(u.id) ? '#eef6ff' : 'transparent',
                        }}
                      >
                        <div className="item-title">{u.name}</div>
                        <div className="item-meta">{u.email}</div>
                      </button>
                    ))}
                  </div>
                )}
                {newMember.userId && (
                  <p className="muted">Utilizator selectat: {memberSearch}</p>
                )}
                <label>
                  <span>Tag</span>
                  <input
                    value={newMember.tag}
                    onChange={(e) => setNewMember({ ...newMember, tag: e.target.value })}
                    placeholder="vegetarian, carnivor..."
                  />
                </label>
                <button type="submit">Adaugă membru</button>
              </form>

              <div className="groups">
                {groups.map((g) => (
                  <div key={g.id} className="group">
                    <div className="item-title">{g.name}</div>
                    <div className="item-meta">
                      {g.members?.map((m) => `${m.user.name}${m.tag ? ` (${m.tag})` : ''}`).join(', ') ||
                        'Fără membri'}
                    </div>
                    <div className="item-meta">
                      Link invitație: <span className="muted">{`${inviteBase}?group=${g.id}`}</span>
                    </div>
                <div className="actions" style={{ marginTop: '8px' }}>
                  <button className="ghost" onClick={() => { selectGroup(String(g.id)); }}>
                    Vezi alimente în grup
                  </button>
                </div>
                  </div>
                ))}
              </div>
            </section>
          </main>

          <main className="content grid-2">
            <section className="panel">
              <h2>Produse disponibile (claim)</h2>
              <form className="form" onSubmit={createClaim}>
                <label>
                  <span>Produs</span>
                  <select
                    value={newClaim.itemId}
                    onChange={(e) => setNewClaim({ ...newClaim, itemId: e.target.value })}
                  >
                    <option value="">Alege produs</option>
                    {availableItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.title} — {i.owner?.name || 'Utilizator'}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit">Trimite claim</button>
              </form>

              <h3 style={{ marginTop: '16px' }}>Claim-urile mele</h3>
              {myClaims.length === 0 ? (
                <p className="muted">Nu ai trimis claim-uri.</p>
              ) : (
                <ul className="list">
                  {myClaims.map((c) => (
                    <li key={c.id} className="list-item">
                      <div className="item-title">{c.item?.title || `Produs #${c.itemId}`}</div>
                      <div className="item-meta">Status: {c.status}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <h2>Share pe social</h2>
              <p className="muted">Stub: generează link pentru rețele.</p>
              <div className="actions">
                {availableItems.slice(0, 3).map((i) => (
                  <div key={i.id} className="share-row">
                    <span>{i.title}</span>
                    <div>
                      <button onClick={() => shareItem(i.id, 'instagram')}>Instagram</button>
                      <button className="ghost" onClick={() => shareItem(i.id, 'facebook')}>
                        Facebook
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {shareLink && (
                <div className="alert">
                  Link generat: <a href={shareLink}>{shareLink}</a>
                </div>
              )}
            </section>

            <section className="panel">
              <h2>Trimite alimente către grup</h2>
              <form className="form" onSubmit={shareToGroup}>
                <label>
                  <span>Grup</span>
                  <select
                    value={selectedGroup}
                    onChange={(e) => { selectGroup(e.target.value); }}
                  >
                    <option value="">Alege grup</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Produs propriu</span>
                  <select
                    value={newClaim.itemId}
                    onChange={(e) => setNewClaim({ ...newClaim, itemId: e.target.value })}
                  >
                    <option value="">Alege produs</option>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.title} ({i.status})
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit">Trimite în grup</button>
              </form>

              {selectedGroup && (
                <>
                  <h3 style={{ marginTop: '12px' }}>Alimente în grup</h3>
                  {groupItems.length === 0 ? (
                    <p className="muted">Nimic trimis în acest grup încă.</p>
                  ) : (
                    <ul className="list">
                      {groupItems.map((i) => (
                        <li key={i.id} className="list-item">
                          <div className="item-title">{i.title}</div>
                          <div className="item-meta">
                            <span>{i.category?.name || 'Fără categorie'}</span>
                            <span>•</span>
                            <span>Owner: {i.owner?.name || 'Necunoscut'}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>

            <section className="panel">
              <h2>Chat grup</h2>
              {!selectedGroup ? (
                <p className="muted">Selectează un grup pentru a vedea discuția.</p>
              ) : (
                <>
                  <div className="chat-box" style={{ maxHeight: '240px', overflowY: 'auto', marginBottom: '12px', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px' }}>
                    {groupMessages.length === 0 ? (
                      <p className="muted">Încă nu există mesaje.</p>
                    ) : (
                      groupMessages.map((m) => (
                        <div key={m.id} style={{ marginBottom: '8px' }}>
                          <div className="item-title" style={{ fontSize: '14px' }}>{m.author?.name || 'Utilizator'}</div>
                          <div className="item-meta" style={{ fontSize: '12px' }}>
                            {new Date(m.createdAt).toLocaleString()}
                          </div>
                          <div>{m.content}</div>
                        </div>
                      ))
                    )}
                  </div>
                  <form className="form" onSubmit={sendMessage}>
                    <label>
                      <span>Mesaj</span>
                      <textarea
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        rows={3}
                        placeholder="Scrie un mesaj pentru grup"
                      />
                    </label>
                    <button type="submit">Trimite</button>
                  </form>
                </>
              )}
            </section>
          </main>
        </>
      )}
    </div>
  );
}

export default App;
