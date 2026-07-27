import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Redirect, useHistory, useParams } from "react-router-dom";
import { api } from "./api";
import { SidebarCliente, SidebarAdmin } from "./Sidebar";
import { launchEmbeddedSignup } from "./facebook";

type Session = { user: { id: string; email: string; name: string | null; isStaff?: boolean } };
type Business = { id: string; name: string; createdAt: string };
type MetaConfig = { metaAppId: string; embeddedSignupEnabled: boolean };

function Shell({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  return <div className="shell">{sidebar}<main className="main">{children}</main></div>;
}

function Topbar({ title, back, right }: { title: string; back?: { to: string; label: string }; right?: ReactNode }) {
  return (
    <div className="topbar">
      <div className="left">
        {back ? <Link to={back.to} className="back"><span className="material" style={{ fontSize: 16, marginRight: 4, verticalAlign: "-2px" }}>arrow_back</span>{back.label}</Link> : null}
        <h1>{title}</h1>
      </div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}

// === AUTH ===

export function App() {
  const session = useQuery({ queryKey: ["session"], queryFn: () => api<Session>("/v1/auth/session"), retry: false });
  if (session.isPending) return <div className="auth-shell"><p className="muted">Cargando…</p></div>;
  return <Redirect to={session.data ? "/businesses" : "/login"} />;
}

export function Login() {
  const queryClient = useQueryClient();
  const history = useHistory();
  const mutation = useMutation({
    mutationFn: (data: { email: string; password: string }) =>
      api<{ user: { id: string; email: string } }>("/v1/auth/login", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      history.replace("/businesses");
    },
  });
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({ email: String(form.get("email")), password: String(form.get("password")) });
  }
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">B</div>
        <h1>Entrar a Botwa</h1>
        <p>Accede a tu CRM de WhatsApp</p>
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="email">Correo electrónico</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Contraseña</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button className="btn full" disabled={mutation.isPending}>{mutation.isPending ? "Entrando…" : "Entrar"}</button>
          {mutation.isError ? <p className="alert" role="alert">No pudimos iniciar sesión. Verifica tu correo y contraseña.</p> : null}
        </form>
        <p className="footer-link"><Link to="/forgot-password">¿Olvidaste tu contraseña?</Link></p>
        <p className="footer-link">¿Aún no tienes cuenta? <Link to="/register">Crear cuenta</Link></p>
      </div>
    </div>
  );
}

export function Register() {
  const mutation = useMutation({
    mutationFn: (data: { email: string; password: string; name?: string }) =>
      api<{ user: { id: string; email: string } }>("/v1/auth/register", { method: "POST", body: JSON.stringify(data) }),
  });
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      email: String(form.get("email")),
      password: String(form.get("password")),
      ...(form.get("name") ? { name: String(form.get("name")) } : {}),
    });
  }
  if (mutation.isSuccess) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-logo">B</div>
          <h1>Cuenta creada</h1>
          <p>Te enviamos un correo para verificar la dirección.</p>
          <Link to="/login" className="btn full">Iniciar sesión</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">B</div>
        <h1>Crear cuenta</h1>
        <p>Empieza a gestionar tu negocio en WhatsApp</p>
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="name">Nombre (opcional)</label>
            <input id="name" name="name" autoComplete="name" maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="email">Correo electrónico</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Contraseña (mínimo 8 caracteres)</label>
            <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
          </div>
          <button className="btn full" disabled={mutation.isPending}>{mutation.isPending ? "Creando…" : "Crear cuenta"}</button>
          {mutation.isError ? <p className="alert" role="alert">No se pudo crear la cuenta. Es posible que ya exista.</p> : null}
        </form>
        <p className="footer-link">¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link></p>
      </div>
    </div>
  );
}

export function ForgotPassword() {
  const mutation = useMutation({
    mutationFn: (email: string) =>
      api("/v1/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  });
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate(String(form.get("email") ?? ""));
  }
  if (mutation.isSuccess || mutation.isError) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-logo">B</div>
          <h1>Revisa tu correo</h1>
          <p>Si la dirección está registrada, te enviamos un enlace para restablecer tu contraseña.</p>
          <Link to="/login" className="btn full">Volver a iniciar sesión</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">B</div>
        <h1>Recuperar contraseña</h1>
        <p>Te enviaremos un enlace para crear una contraseña nueva.</p>
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="email">Correo electrónico</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <button className="btn full" disabled={mutation.isPending}>{mutation.isPending ? "Enviando…" : "Enviar enlace"}</button>
        </form>
        <p className="footer-link"><Link to="/login">← Volver a iniciar sesión</Link></p>
      </div>
    </div>
  );
}

export function ResetPassword() {
  const history = useHistory();
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";
  const mutation = useMutation({
    mutationFn: (password: string) =>
      api("/v1/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),
    onSuccess: () => { history.replace("/login"); },
  });
  if (!token) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-logo">B</div>
          <h1>Enlace inválido</h1>
          <p>El enlace de recuperación no es válido o ya expiró.</p>
          <Link to="/forgot-password" className="btn full">Pedir uno nuevo</Link>
        </div>
      </div>
    );
  }
  if (mutation.isSuccess) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-logo">B</div>
          <h1>Listo</h1>
          <p>Tu contraseña se actualizó. Iniciá sesión con la nueva.</p>
          <Link to="/login" className="btn full">Iniciar sesión</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">B</div>
        <h1>Nueva contraseña</h1>
        <p>Elegí una contraseña nueva para tu cuenta.</p>
        <form onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const password = String(form.get("password") ?? "");
          const confirm = String(form.get("confirm") ?? "");
          if (password !== confirm) { alert("Las contraseñas no coinciden"); return; }
          if (password.length < 8) { alert("La contraseña debe tener al menos 8 caracteres"); return; }
          mutation.mutate(password);
        }} noValidate>
          <div className="field">
            <label htmlFor="password">Nueva contraseña</label>
            <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
          </div>
          <div className="field">
            <label htmlFor="confirm">Repetí la contraseña</label>
            <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
          </div>
          <button className="btn full" disabled={mutation.isPending}>{mutation.isPending ? "Guardando…" : "Cambiar contraseña"}</button>
          {mutation.isError ? <p className="alert">El enlace no es válido o expiró.</p> : null}
        </form>
      </div>
    </div>
  );
}

// === BUSINESSES (home) ===

export function Businesses() {
  const queryClient = useQueryClient();
  const history = useHistory();
  const businesses = useQuery({ queryKey: ["businesses"], queryFn: () => api<Business[]>("/v1/businesses"), retry: false });
  const create = useMutation({
    mutationFn: (name: string) => api<Business>("/v1/businesses", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: (biz) => {
      void queryClient.invalidateQueries({ queryKey: ["businesses"] });
      history.push(`/businesses/${biz.id}`);
    },
  });
  if (businesses.isError) return <Redirect to="/login" />;
  return (
    <Shell sidebar={<SidebarCliente active="none" />}>
      <Topbar title="Tus Negocios" />
      <p className="subtitle">Crea y gestiona los Negocios que atiendes por WhatsApp.</p>
      <div className="split">
        <div className="card">
          <h2>Crear Negocio</h2>
          <form className="stack" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const name = String(form.get("name") ?? "").trim();
            if (name) create.mutate(name);
          }}>
            <div className="field">
              <label htmlFor="biz-name">Nombre comercial</label>
              <input id="biz-name" name="name" minLength={2} maxLength={120} required placeholder="Tienda Demo" />
            </div>
            <button className="btn" disabled={create.isPending}>{create.isPending ? "Creando…" : "Crear"}</button>
            {create.isError ? <p className="alert">No se pudo crear el Negocio.</p> : null}
          </form>
        </div>
        <section>
          <h2 className="muted small" style={{ margin: "0 0 12px", textTransform: "uppercase", letterSpacing: "0.05em", fontSize: 12 }}>Negocios</h2>
          {businesses.isPending ? <p className="muted">Cargando…</p> :
            businesses.data && businesses.data.length > 0 ? (
              <div className="card-grid three">
                {businesses.data.map((b) => (
                  <Link key={b.id} to={`/businesses/${b.id}`} className="biz-card" style={{ color: "inherit" }}>
                    <div className="flex center gap-sm"><span className="material" style={{ color: "var(--primary)" }}>storefront</span></div>
                    <div className="name">{b.name}</div>
                    <div className="meta">Creado {new Date(b.createdAt).toLocaleDateString()}</div>
                    <span className="btn secondary sm" style={{ alignSelf: "flex-start" }}>Abrir</span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="card">
                <p className="muted">Aún no tienes Negocios. Crea tu primer Negocio para empezar.</p>
              </div>
            )}
        </section>
      </div>
    </Shell>
  );
}

// === BUSINESS SETTINGS (phone wizard) ===

type PhoneNumber = {
  phoneNumberId: string;
  displayPhone: string;
  displayName: string;
  status: string;
  userAccessTokenExpiresAt?: string | null;
  wabaId?: string | null;
};

function ReconnectBanner({ businessId }: { businessId: string }) {
  const config = useQuery({ queryKey: ["meta-config"], queryFn: () => api<MetaConfig>("/v1/config") });
  const queryClient = useQueryClient();
  const phone = useQuery({ queryKey: ["phone-number", businessId], queryFn: () => api<PhoneNumber | null>(`/v1/businesses/${businessId}/phone-number`) });
  const history = useHistory();

  if (!phone.data?.userAccessTokenExpiresAt || !config.data?.embeddedSignupEnabled) return null;
  const expiresAt = new Date(phone.data.userAccessTokenExpiresAt);
  const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (daysLeft > 7) return null;

  const reconnect = async () => {
    const start = await api<{ method: "facebook"; configId: string; redirectUri: string; state: string }>(`/v1/businesses/${businessId}/phone-number/embedded-start`, { method: "POST" });
    const { code } = await launchEmbeddedSignup({ appId: config.data!.metaAppId, configId: start.configId, redirectUri: start.redirectUri });
    await api(`/v1/auth/meta/callback`, { method: "POST", body: JSON.stringify({ code, state: start.state, businessId }) });
    void queryClient.invalidateQueries({ queryKey: ["phone-number", businessId] });
    history.push(`/businesses/${businessId}`);
  };

  return (
    <div className="notice mb-3" role="alert" style={{ background: "rgba(255,176,32,0.15)", borderLeftColor: "var(--warning)" }}>
      <strong>Reconecta tu WhatsApp.</strong> El acceso vence {daysLeft <= 0 ? "hoy" : `en ${daysLeft} día${daysLeft === 1 ? "" : "s"}`} ({expiresAt.toLocaleDateString()}).
      {" "}
      <button className="link-btn" onClick={() => { void reconnect(); }} style={{ display: "inline", color: "var(--primary)" }}>Reconectar ahora</button>
    </div>
  );
}

export function BusinessSettings() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const history = useHistory();
  const config = useQuery({ queryKey: ["meta-config"], queryFn: () => api<MetaConfig>("/v1/config") });
  const phone = useQuery({ queryKey: ["phone-number", id], queryFn: () => api<PhoneNumber | null>(`/v1/businesses/${id}/phone-number`) });
  const startMock = useMutation({
    mutationFn: (data: { displayPhone: string; displayName: string }) =>
      api<PhoneNumber>(`/v1/businesses/${id}/phone-number/start`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["phone-number", id] }),
  });
  const startEmbedded = useMutation({
    mutationFn: () => api<{ method: "facebook"; configId: string; redirectUri: string; state: string }>(`/v1/businesses/${id}/phone-number/embedded-start`, { method: "POST" }),
  });
  const metaCallback = useMutation({
    mutationFn: (input: { code: string; state: string }) =>
      api(`/v1/auth/meta/callback`, { method: "POST", body: JSON.stringify({ code: input.code, state: input.state, businessId: id }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["phone-number", id] });
      history.push(`/businesses/${id}`);
    },
  });
  const reconnect = async () => {
    if (!config.data?.embeddedSignupEnabled) return;
    try {
      const start = await startEmbedded.mutateAsync();
      const { code } = await launchEmbeddedSignup({ appId: config.data.metaAppId, configId: start.configId, redirectUri: start.redirectUri });
      await metaCallback.mutateAsync({ code, state: start.state });
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo conectar con Facebook");
    }
  };
  const start = startMock; // alias preservado por si se referencia más abajo
  const verify = useMutation({
    mutationFn: (code: string) => api<PhoneNumber>(`/v1/businesses/${id}/phone-number/verify`, { method: "POST", body: JSON.stringify({ code }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["phone-number", id] }),
  });
  const disconnect = useMutation({
    mutationFn: () => api(`/v1/businesses/${id}/phone-number`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["phone-number", id] });
      void queryClient.invalidateQueries({ queryKey: ["conversations", id] });
    },
  });

  const embeddedEnabled = config.data?.embeddedSignupEnabled === true;
  const noticeText = embeddedEnabled
    ? "Conectá tu número de WhatsApp Business a través de Facebook. Vas a necesitar ser el owner de la WABA en Meta."
    : "Modo de desarrollo: Meta está simulado. Usa el código 123456.";

  return (
    <Shell sidebar={<SidebarCliente active="settings" businessId={id} />}>
      <Topbar title="Conectar WhatsApp" back={{ to: "/businesses", label: "Negocios" }} right={<Link to={`/businesses/${id}/inbox`} className="btn secondary sm">Abrir bandeja</Link>} />
      <ReconnectBanner businessId={id} />
      <div className="stepper">
        <div className={`step${!phone.data ? " active" : ""}`}><div className="dot">1</div><span>Datos</span></div>
        <div className="line" />
        <div className={`step${phone.data && phone.data.status !== "ACTIVE" ? " active" : ""}`}><div className="dot">2</div><span>Verificación</span></div>
        <div className="line" />
        <div className={`step${phone.data?.status === "ACTIVE" ? " active" : ""}`}><div className="dot">3</div><span>Activo</span></div>
      </div>
      <p className="notice mb-3">{noticeText}</p>
      {!phone.data ? (
        <div className="card" style={{ maxWidth: 520 }}>
          <h2>1. Conectar WhatsApp</h2>
          {embeddedEnabled ? (
            <>
              <p className="muted small">Vamos a abrir un popup de Facebook. Inicia sesión con la cuenta que administra la WABA, elegí el número que querés conectar y autorizá los permisos.</p>
              <button className="btn mt-2" onClick={() => { void reconnect(); }} disabled={startEmbedded.isPending || metaCallback.isPending}>
                <span className="material" style={{ fontSize: 16 }}>open_in_new</span>
                {startEmbedded.isPending || metaCallback.isPending ? "Conectando…" : "Continuar con Facebook"}
              </button>
              {(startEmbedded.isError || metaCallback.isError) ? <p className="alert mt-2">No se pudo iniciar la conexión. Reintentá.</p> : null}
            </>
          ) : (
            <form className="stack" onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              startMock.mutate({
                displayName: String(form.get("displayName") ?? ""),
                displayPhone: String(form.get("displayPhone") ?? ""),
              });
            }}>
              <div className="field"><label htmlFor="displayName">Nombre comercial</label><input id="displayName" name="displayName" minLength={2} maxLength={120} required /></div>
              <div className="field"><label htmlFor="displayPhone">Número con código de país</label><input id="displayPhone" name="displayPhone" type="tel" placeholder="+5491155556666" minLength={8} maxLength={24} required /></div>
              <button className="btn" disabled={startMock.isPending}>{startMock.isPending ? "Enviando…" : "Continuar"}</button>
              {startMock.isError ? <p className="alert">No se pudo iniciar la conexión.</p> : null}
            </form>
          )}
        </div>
      ) : phone.data.status !== "ACTIVE" ? (
        <div className="card" style={{ maxWidth: 520 }}>
          <h2>2. Verificación</h2>
          <p className="muted small mb-2">{phone.data.displayName} · {phone.data.displayPhone}</p>
          <form className="stack" onSubmit={(event) => {
            event.preventDefault();
            const code = String(new FormData(event.currentTarget).get("code") ?? "");
            if (code) verify.mutate(code);
          }}>
            <div className="field"><label htmlFor="code">Código de seis dígitos</label><input id="code" name="code" inputMode="numeric" pattern="[0-9]{6}" placeholder="123456" required /></div>
            <button className="btn" disabled={verify.isPending}>{verify.isPending ? "Verificando…" : "Verificar"}</button>
            {verify.isError ? <p className="alert">El código no es válido.</p> : null}
          </form>
        </div>
      ) : (
        <div className="card" style={{ maxWidth: 520 }}>
          <h2>3. Número activo</h2>
          <p className="muted small">Tu WhatsApp Business está conectado y listo para recibir mensajes.</p>
          <div className="divider" />
          <p><strong>{phone.data.displayName}</strong><br /><span className="muted small">{phone.data.displayPhone}</span></p>
          <span className="badge success">Activo</span>
          <div className="mt-3 flex gap-sm">
            <Link to={`/businesses/${id}/inbox`} className="btn">Ir a la bandeja</Link>
            <button
              className="btn danger"
              disabled={disconnect.isPending}
              onClick={() => {
                if (confirm(`¿Desvincular el número ${phone.data?.displayPhone}?\n\nLas conversaciones pasadas se conservan. Vas a tener que volver a verificar si querés reconectar.`)) {
                  disconnect.mutate();
                }
              }}
            >
              <span className="material" style={{ fontSize: 16 }}>link_off</span>
              {disconnect.isPending ? "Desvinculando…" : "Desvincular número"}
            </button>
          </div>
          {disconnect.isError ? <p className="alert mt-2">No se pudo desvincular. Intentá de nuevo.</p> : null}
        </div>
      )}
    </Shell>
  );
}

// === INBOX ===

type Conversation = { id: string; status: string; contact: { name: string | null; waId: string }; messages: Array<{ body: string | null; timestamp: string }> };
type Message = { id: string; direction: string; authorType: string; body: string | null; timestamp: string; status: string };

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s.includes("resuelt")) return <span className="badge success">Resuelta</span>;
  if (s.includes("curso") || s.includes("asignad")) return <span className="badge info">En curso</span>;
  if (s.includes("pool") || s.includes("pend")) return <span className="badge warning">Pendiente</span>;
  return <span className="badge">{status}</span>;
}

export function Inbox() {
  const { id } = useParams<{ id: string }>();
  const [selected, setSelected] = useState<string>();
  const queryClient = useQueryClient();
  const conversations = useQuery({ queryKey: ["conversations", id], queryFn: () => api<{ items: Conversation[] }>(`/v1/businesses/${id}/conversations`) });
  const messages = useQuery({ queryKey: ["messages", selected], queryFn: () => api<{ items: Message[] }>(`/v1/conversations/${selected}/messages`), enabled: Boolean(selected) });
  const send = useMutation({
    mutationFn: (body: string) => api(`/v1/conversations/${selected}/messages`, { method: "POST", body: JSON.stringify({ clientMsgId: crypto.randomUUID(), type: "TEXT", body }) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["messages", selected] }); },
  });
  const assign = useMutation({
    mutationFn: () => api(`/v1/conversations/${selected}/assign`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["conversations", id] }); },
  });
  return (
    <Shell sidebar={<SidebarCliente active="inbox" businessId={id} />}>
      <Topbar title="Bandeja" back={{ to: `/businesses/${id}`, label: "Configuración" }} />
      <div className="inbox">
        <div className="conv-list">
          <div className="head">
            <input className="search" placeholder="Buscar conversación…" aria-label="Buscar conversación" />
          </div>
          <ul>
            {conversations.isPending ? <li className="muted small" style={{ padding: 12 }}>Cargando…</li> :
              conversations.data?.items.length === 0 ? <li className="muted small" style={{ padding: 12 }}>Sin conversaciones.</li> :
                conversations.data?.items.map((c) => (
                  <li key={c.id}>
                    <button className={`conv-item${selected === c.id ? " selected" : ""}`} onClick={() => setSelected(c.id)} aria-pressed={selected === c.id}>
                      <div className="avatar">{(c.contact.name ?? c.contact.waId)[0]?.toUpperCase() ?? "?"}</div>
                      <div className="body">
                        <div className="name">{c.contact.name ?? c.contact.waId}</div>
                        <div className="preview">{c.messages[0]?.body ?? "Sin mensajes"}</div>
                      </div>
                      <div className="meta">
                        {statusBadge(c.status)}
                      </div>
                    </button>
                  </li>
                ))}
          </ul>
        </div>
        <section className="thread" aria-labelledby="thread-title">
          {!selected ? (
            <div className="empty"><p className="muted">Selecciona una conversación para empezar.</p></div>
          ) : (
            <>
              <div className="thread-head">
                <h3>Conversación</h3>
                <button className="btn sm secondary" onClick={() => assign.mutate()} disabled={assign.isPending}>
                  {assign.isPending ? "Asignando…" : "Tomar conversación"}
                </button>
              </div>
              <ol className="messages">
                {messages.isPending ? <li className="muted small" style={{ background: "transparent" }}>Cargando…</li> :
                  messages.data?.items.map((m) => (
                    <li key={m.id} className={m.direction.toLowerCase()}>
                      <span>{m.body ?? "(adjunto)"}</span>
                      <time dateTime={m.timestamp}>{new Date(m.timestamp).toLocaleString()}</time>
                    </li>
                  ))}
              </ol>
              <form className="composer" onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const body = String(form.get("body") ?? "").trim();
                if (body) {
                  send.mutate(body);
                  event.currentTarget.reset();
                }
              }}>
                <textarea name="body" placeholder="Escribe un mensaje…" required maxLength={4096} />
                <button className="btn" type="submit" disabled={send.isPending}>{send.isPending ? "Enviando…" : "Enviar"}</button>
              </form>
            </>
          )}
        </section>
      </div>
    </Shell>
  );
}

// === BOT RULES ===

type BotRule = { id: string; name: string; type: "KEYWORD" | "REGEX"; pattern: string; action: "RESPOND" | "ESCALATE"; response?: string; enabled: boolean };

export function BotRules() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: ["bot-rules", id], queryFn: () => api<BotRule[]>(`/v1/businesses/${id}/bot-rules`) });
  const create = useMutation({
    mutationFn: (data: Omit<BotRule, "id">) => api(`/v1/businesses/${id}/bot-rules`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bot-rules", id] }),
  });
  const remove = useMutation({
    mutationFn: (ruleId: string) => api(`/v1/businesses/${id}/bot-rules/${ruleId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bot-rules", id] }),
  });
  return (
    <Shell sidebar={<SidebarCliente active="automations" businessId={id} />}>
      <Topbar title="Automatizaciones" back={{ to: `/businesses/${id}`, label: "Configuración" }} />
      <p className="subtitle">Configura respuestas automáticas por palabras clave o regex.</p>
      <div className="card mb-3">
        <h2>Nueva regla</h2>
        <form className="stack" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const type = String(form.get("type")) as BotRule["type"];
          const action = String(form.get("action")) as BotRule["action"];
          create.mutate({
            name: String(form.get("name") ?? "").trim(),
            type,
            pattern: String(form.get("pattern") ?? "").trim(),
            action,
            response: action === "RESPOND" ? String(form.get("response") ?? "") : undefined,
            enabled: true,
          });
          event.currentTarget.reset();
        }}>
          <div className="field"><label htmlFor="rname">Nombre</label><input id="rname" name="name" required maxLength={80} placeholder="Bienvenida" /></div>
          <div className="flex gap-md">
            <div className="field" style={{ flex: 1 }}><label htmlFor="rtype">Tipo</label>
              <select id="rtype" name="type" required><option value="KEYWORD">Palabra clave</option><option value="REGEX">Expresión regular</option></select>
            </div>
            <div className="field" style={{ flex: 2 }}><label htmlFor="rpattern">Patrón</label><input id="rpattern" name="pattern" required placeholder="hola|hi" /></div>
            <div className="field" style={{ flex: 1 }}><label htmlFor="raction">Acción</label>
              <select id="raction" name="action" required><option value="RESPOND">Responder</option><option value="ESCALATE">Escalar a humano</option></select>
            </div>
          </div>
          <div className="field"><label htmlFor="rresponse">Respuesta (sólo si Acción = Responder)</label><textarea id="rresponse" name="response" maxLength={1024} placeholder="¡Hola! ¿En qué te podemos ayudar?" /></div>
          <button className="btn" disabled={create.isPending}>{create.isPending ? "Creando…" : "Crear regla"}</button>
          {create.isError ? <p className="alert">No se pudo crear la regla.</p> : null}
        </form>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Nombre</th><th>Tipo</th><th>Patrón</th><th>Acción</th><th></th></tr></thead>
          <tbody>
            {rules.isPending ? <tr><td colSpan={5} className="muted small">Cargando…</td></tr> :
              rules.data?.length === 0 ? <tr><td colSpan={5} className="muted small">Aún no hay reglas.</td></tr> :
                rules.data?.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td><span className={`badge ${r.type === "REGEX" ? "info" : "primary"}`}>{r.type}</span></td>
                    <td className="muted small"><code>{r.pattern}</code></td>
                    <td>{r.action === "RESPOND" ? "Responde" : "Escala a humano"}</td>
                    <td style={{ textAlign: "right" }}><button className="btn ghost sm" onClick={() => { if (confirm(`¿Eliminar la regla "${r.name}"?`)) remove.mutate(r.id); }} aria-label={`Eliminar ${r.name}`}><span className="material" style={{ fontSize: 16 }}>delete</span></button></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}

// === MEMBERS ===

type Member = { id: string; email: string; name: string | null; role: string; joinedAt: string };

export function Members() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const members = useQuery({ queryKey: ["members", id], queryFn: () => api<Member[]>(`/v1/businesses/${id}/members`) });
  const invite = useMutation({
    mutationFn: (data: { email: string; role: string }) => api(`/v1/businesses/${id}/members`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["members", id] }),
  });
  const remove = useMutation({
    mutationFn: (memberId: string) => api(`/v1/businesses/${id}/members/${memberId}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["members", id] }),
  });
  return (
    <Shell sidebar={<SidebarCliente active="members" businessId={id} />}>
      <Topbar title="Miembros" back={{ to: `/businesses/${id}`, label: "Configuración" }} />
      <p className="subtitle">Gestiona quién accede a este Negocio y con qué permisos.</p>
      <div className="split">
        <div className="card">
          <h2>Invitar miembro</h2>
          <form className="stack" onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            invite.mutate({ email: String(form.get("email") ?? ""), role: String(form.get("role") ?? "Agente") });
            event.currentTarget.reset();
          }}>
            <div className="field"><label htmlFor="memail">Correo</label><input id="memail" name="email" type="email" required /></div>
            <div className="field"><label htmlFor="mrole">Rol</label>
              <select id="mrole" name="role" required>
                <option value="Dueño">Dueño</option>
                <option value="Administrador">Administrador</option>
                <option value="Agente">Agente</option>
                <option value="Analista">Analista</option>
              </select>
            </div>
            <button className="btn" disabled={invite.isPending}>{invite.isPending ? "Enviando…" : "Enviar invitación"}</button>
            {invite.isError ? <p className="alert">No se pudo invitar al miembro.</p> : null}
          </form>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Miembro</th><th>Rol</th><th>Ingreso</th><th></th></tr></thead>
            <tbody>
              {members.isPending ? <tr><td colSpan={4} className="muted small">Cargando…</td></tr> :
                members.data?.length === 0 ? <tr><td colSpan={4} className="muted small">Aún no hay miembros.</td></tr> :
                  members.data?.map((m) => (
                    <tr key={m.id}>
                      <td><div style={{ fontWeight: 500 }}>{m.name ?? "—"}</div><div className="muted small">{m.email}</div></td>
                      <td><span className="badge">{m.role}</span></td>
                      <td className="muted small">{new Date(m.joinedAt).toLocaleDateString()}</td>
                      <td style={{ textAlign: "right" }}>
                        {m.role !== "Dueño" ? (
                          <button className="btn ghost sm" onClick={() => { if (confirm(`¿Eliminar a ${m.email}?`)) remove.mutate(m.id); }} aria-label={`Eliminar ${m.email}`}><span className="material" style={{ fontSize: 16 }}>person_remove</span></button>
                        ) : <span className="muted tiny">Dueño protegido</span>}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}

// === METRICS ===

type MetricsSummary = {
  open: number;
  unassigned: number;
  oldAssigned: number;
  resolvedToday: number;
  botResolutionPercent: number;
  llmCostUsd: string | number;
  from?: string;
  to?: string;
};

function Trend({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <div className="trend" style={{ color: positive ? "var(--success)" : "var(--warning)" }}>
      <span className="material" style={{ fontSize: 14 }}>{positive ? "trending_up" : "trending_down"}</span>
      {positive ? "+" : ""}{value}%
    </div>
  );
}

export function Metrics() {
  const { id } = useParams<{ id: string }>();
  const metrics = useQuery({ queryKey: ["metrics", id], queryFn: () => api<MetricsSummary>(`/v1/businesses/${id}/metrics/summary`) });
  const m = metrics.data;
  const llmCost = m ? Number(m.llmCostUsd) : 0;
  return (
    <Shell sidebar={<SidebarCliente active="metrics" businessId={id} />}>
      <Topbar title="Métricas" back={{ to: `/businesses/${id}`, label: "Configuración" }} />
      <p className="subtitle">Resumen de actividad y rendimiento del Negocio.</p>
      <div className="kpi-grid mb-3">
        <div className="kpi"><div className="label">Abiertas</div><div className="value">{m?.open ?? "—"}</div><Trend value={12} /></div>
        <div className="kpi"><div className="label">Sin asignar</div><div className="value">{m?.unassigned ?? "—"}</div><Trend value={-8} /></div>
        <div className="kpi"><div className="label">Asignadas &gt; 5 min</div><div className="value">{m?.oldAssigned ?? "—"}</div><Trend value={3} /></div>
        <div className="kpi"><div className="label">Resueltas hoy</div><div className="value">{m?.resolvedToday ?? "—"}</div><Trend value={-2} /></div>
      </div>
      <div className="card-grid mb-3">
        <div className="card">
          <h2>Resolución por bot</h2>
          <p className="muted small">Porcentaje de conversaciones resueltas automáticamente por el bot.</p>
          <div style={{ fontSize: 36, fontWeight: 700, color: "var(--primary)", marginTop: 12 }}>
            {m ? `${m.botResolutionPercent}%` : "—"}
          </div>
        </div>
        <div className="card">
          <h2>Costo LLM (30 días)</h2>
          <p className="muted small">Costo total de las llamadas a modelos de lenguaje.</p>
          <div style={{ fontSize: 36, fontWeight: 700, color: "var(--primary)", marginTop: 12 }}>
            {m ? `$${llmCost.toFixed(2)}` : "—"}
          </div>
        </div>
        <div className="card">
          <h2>Rango consultado</h2>
          <p className="muted small">Período de los datos mostrados.</p>
          <div className="mt-2">
            <div className="small"><strong>Desde:</strong> {m?.from ? new Date(m.from).toLocaleDateString() : "—"}</div>
            <div className="small"><strong>Hasta:</strong> {m?.to ? new Date(m.to).toLocaleDateString() : "—"}</div>
          </div>
        </div>
      </div>
    </Shell>
  );
}

// === ADMIN ===

type AdminUser = { id: string; email: string; name: string | null; isStaff: boolean; createdAt: string; membershipCount: number; sessionCount: number };
type AdminBusiness = { id: string; name: string; createdAt: string; memberCount: number; conversationCount: number };

export function AdminUsers() {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<AdminUser[]>("/v1/admin/users") });
  const remove = useMutation({
    mutationFn: (userId: string) => api(`/v1/admin/users/${userId}`, { method: "DELETE" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["admin-users"] }); },
  });
  return (
    <Shell sidebar={<SidebarAdmin active="users" />}>
      <Topbar title="Admin · Usuarios" />
      <p className="subtitle">Gestiona los usuarios de la plataforma y sus permisos.</p>
      <div className="split">
        <div className="card">
          <h2>Crear usuario</h2>
          <form className="stack" onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            try {
              await api("/v1/admin/users", {
                method: "POST",
                body: JSON.stringify({
                  email: form.get("email"),
                  password: form.get("password"),
                  ...(form.get("name") ? { name: form.get("name") } : {}),
                  isStaff: form.get("isStaff") === "on",
                }),
              });
              event.currentTarget.reset();
              await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
            } catch { alert("No se pudo crear el usuario"); }
          }}>
            <div className="field"><label htmlFor="au-email">Correo</label><input id="au-email" name="email" type="email" required /></div>
            <div className="field"><label htmlFor="au-name">Nombre (opcional)</label><input id="au-name" name="name" maxLength={120} /></div>
            <div className="field"><label htmlFor="au-pass">Contraseña (mínimo 8 caracteres)</label><input id="au-pass" name="password" type="password" minLength={8} required /></div>
            <label className="checkbox"><input type="checkbox" name="isStaff" /> Es súper-admin</label>
            <button className="btn" type="submit">Crear</button>
          </form>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Email</th><th>Nombre</th><th>Rol</th><th>Membresías</th><th>Sesiones</th><th></th></tr></thead>
            <tbody>
              {users.isPending ? <tr><td colSpan={6} className="muted small">Cargando…</td></tr> :
                users.data?.length === 0 ? <tr><td colSpan={6} className="muted small">Sin usuarios.</td></tr> :
                  users.data?.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>{u.name ?? "—"}</td>
                      <td><span className={`badge ${u.isStaff ? "primary" : ""}`}>{u.isStaff ? "Súper-admin" : "Usuario"}</span></td>
                      <td>{u.membershipCount}</td>
                      <td>{u.sessionCount}</td>
                      <td style={{ textAlign: "right" }}>
                        <button className="btn danger sm" onClick={() => { if (confirm(`¿Eliminar a ${u.email}?`)) remove.mutate(u.id); }} aria-label={`Eliminar ${u.email}`}>Eliminar</button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}

export function AdminBusinesses() {
  const queryClient = useQueryClient();
  const businesses = useQuery({ queryKey: ["admin-businesses"], queryFn: () => api<AdminBusiness[]>("/v1/admin/businesses") });
  const remove = useMutation({
    mutationFn: (bizId: string) => api(`/v1/admin/businesses/${bizId}`, { method: "DELETE" }),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["admin-businesses"] }); },
  });
  return (
    <Shell sidebar={<SidebarAdmin active="businesses" />}>
      <Topbar title="Admin · Negocios" />
      <p className="subtitle">Todos los Negocios registrados en la plataforma.</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Nombre</th><th>Miembros</th><th>Conversaciones</th><th>Creado</th><th></th></tr></thead>
          <tbody>
            {businesses.isPending ? <tr><td colSpan={5} className="muted small">Cargando…</td></tr> :
              businesses.data?.length === 0 ? <tr><td colSpan={5} className="muted small">Sin negocios.</td></tr> :
                businesses.data?.map((b) => (
                  <tr key={b.id}>
                    <td>{b.name}</td>
                    <td>{b.memberCount}</td>
                    <td>{b.conversationCount}</td>
                    <td className="muted small">{new Date(b.createdAt).toLocaleDateString()}</td>
                    <td style={{ textAlign: "right" }}>
                      <button className="btn danger sm" onClick={() => { if (confirm(`¿Eliminar el negocio ${b.name} y todos sus datos?`)) remove.mutate(b.id); }} aria-label={`Eliminar ${b.name}`}>Eliminar</button>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
