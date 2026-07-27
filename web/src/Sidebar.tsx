import { Link, useHistory } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

type Session = { user: { id: string; email: string; name: string | null; isStaff?: boolean } };
type ActiveKey = "inbox" | "contacts" | "automations" | "metrics" | "members" | "settings" | "none";
type AdminKey = "users" | "businesses";

const CLIENTE_ITEMS: Array<{ key: ActiveKey; label: string; icon: string; path: (b?: string) => string }> = [
  { key: "inbox", label: "Bandeja", icon: "inbox", path: (b) => `/businesses/${b}/inbox` },
  { key: "contacts", label: "Contactos", icon: "person", path: () => "#" },
  { key: "automations", label: "Automatizaciones", icon: "bolt", path: (b) => `/businesses/${b}/bot-rules` },
  { key: "metrics", label: "Métricas", icon: "monitoring", path: (b) => `/businesses/${b}/metrics` },
  { key: "members", label: "Miembros", icon: "group", path: (b) => `/businesses/${b}/members` },
  { key: "settings", label: "Configuración", icon: "settings", path: (b) => `/businesses/${b}` },
];

function initials(name: string | null | undefined, email: string): string {
  const base = name?.trim() || email;
  const parts = base.split(/\s+|@/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
}

export function LogoutButton({ muted = false }: { muted?: boolean }) {
  const queryClient = useQueryClient();
  const history = useHistory();
  const mutation = useMutation({
    mutationFn: () => api("/v1/auth/logout", { method: "POST" }),
    onSuccess: async () => {
      await queryClient.clear();
      history.replace("/login");
    },
  });
  return (
    <button className="link-btn" onClick={() => mutation.mutate()} disabled={mutation.isPending} style={muted ? { color: "var(--text-muted)" } : undefined}>
      <span className="material" style={{ fontSize: 16, marginRight: 4 }}>logout</span>
      {mutation.isPending ? "Cerrando…" : "Cerrar sesión"}
    </button>
  );
}

function UserChip() {
  const session = useQuery({ queryKey: ["session"], queryFn: () => api<Session>("/v1/auth/session"), retry: false });
  if (!session.data) return null;
  const u = session.data.user;
  return (
    <div className="sidebar-user">
      <div className="avatar">{initials(u.name, u.email)}</div>
      <div style={{ minWidth: 0 }}>
        <div className="name" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>{u.name ?? "Usuario"}</div>
        <div className="email" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>{u.email}</div>
      </div>
    </div>
  );
}

export function SidebarCliente({ active, businessId }: { active: ActiveKey; businessId?: string }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="logo">B</div>
        <div className="name">Botwa</div>
      </div>
      <nav className="sidebar-nav" aria-label="Principal">
        {CLIENTE_ITEMS.map((item) => {
          const isActive = item.key === active;
          const isDisabled = !businessId;
          const path = isDisabled ? "#" : item.path(businessId);
          return (
            <Link
              key={item.key}
              to={path}
              className={`nav-item${isActive ? " active" : ""}${isDisabled ? " disabled" : ""}`}
              onClick={(e) => { if (isDisabled) e.preventDefault(); }}
              aria-current={isActive ? "page" : undefined}
            >
              <span className="material">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <UserChip />
        <LogoutButton muted />
      </div>
    </aside>
  );
}

export function SidebarAdmin({ active }: { active: AdminKey }) {
  return (
    <aside className="sidebar admin">
      <span className="sidebar-pill">ADMIN</span>
      <Link to="/businesses" className="sidebar-link-back">
        <span className="material" style={{ fontSize: 16 }}>arrow_back</span>
        Volver al CRM
      </Link>
      <nav className="sidebar-nav" aria-label="Administración">
        <Link to="/admin/users" className={`nav-item${active === "users" ? " active" : ""}`} aria-current={active === "users" ? "page" : undefined}>
          <span className="material">group</span>
          <span>Usuarios</span>
        </Link>
        <Link to="/admin/businesses" className={`nav-item${active === "businesses" ? " active" : ""}`} aria-current={active === "businesses" ? "page" : undefined}>
          <span className="material">storefront</span>
          <span>Negocios</span>
        </Link>
      </nav>
      <div className="sidebar-foot">
        <UserChip />
        <LogoutButton muted />
      </div>
    </aside>
  );
}
