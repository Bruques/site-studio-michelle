import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

export const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

/** "09:00:00" -> "09:00" */
export const hhmm = (t: string) => t.slice(0, 5);

export const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const fmtMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

type Intervalo = { inicio: string; fim: string };

/** Horários de início possíveis numa janela: o serviço precisa caber e não pode sobrepor nada. */
export function gerarSlots(inicio: string, fim: string, passo: number, duracao: number, ocupados: Intervalo[]): string[] {
  const occ = ocupados.map((o) => [toMin(o.inicio), toMin(o.fim)]);
  const slots: string[] = [];
  for (let m = toMin(inicio); m + duracao <= toMin(fim); m += passo) {
    if (!occ.some(([a, b]) => m < b && m + duracao > a)) slots.push(fmtMin(m));
  }
  return slots;
}

/** 150 -> "2h30", 45 -> "45 min" */
export function formatarDuracao(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export function formatarPreco(valor: number | null) {
  if (valor === null || valor === undefined) return "";
  return `R$ ${Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(Number(valor)) ? 0 : 2 })}`;
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** Link do WhatsApp para um telefone brasileiro digitado livremente. */
export function linkWhatsApp(telefone: string, mensagem: string) {
  let n = telefone.replace(/\D/g, "");
  if (n.length <= 11) n = "55" + n;
  return `https://wa.me/${n}?text=${encodeURIComponent(mensagem)}`;
}

export function formatarData(iso: string) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
