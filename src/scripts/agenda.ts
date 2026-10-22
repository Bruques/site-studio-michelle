import c from "../config/cliente.json";
import { supabase, gerarSlots, hhmm, toMin, formatarData, formatarDuracao, formatarPreco, escapeHtml } from "../lib/supabase";

type Servico = { nome: string; descricao: string | null; preco: number | null; duracao_min: number };
type Dia = { janelas: { inicio: string; fim: string; passo_min: number }[]; ocupados: { inicio: string; fim: string }[]; bloqueado: boolean };

const form = document.getElementById("form-agenda") as HTMLFormElement;
const opcoesEl = document.getElementById("opcoes-servico")!;
const resumoEl = document.getElementById("resumo-servicos")!;
const dataEl = form.elements.namedItem("data") as HTMLInputElement;
const horaEl = form.elements.namedItem("hora") as HTMLSelectElement;
const aviso = document.getElementById("agenda-aviso")!;
const sucesso = document.getElementById("agenda-sucesso")!;
const botao = form.querySelector<HTMLButtonElement>("button[type=submit]")!;

let negocioId: string | null = null;
let servicos: Servico[] = [];
let dia: Dia | null = null;

const hoje = new Date();
dataEl.min = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;

function mensagem(texto: string) {
  aviso.textContent = texto;
  aviso.hidden = !texto;
}

function opcoes(horas: string[], placeholder: string) {
  horaEl.innerHTML = "";
  const base = new Option(placeholder, "");
  base.disabled = true;
  base.selected = true;
  horaEl.add(base);
  horas.forEach((h) => horaEl.add(new Option(h, h)));
  horaEl.disabled = horas.length === 0;
  botao.disabled = true;
}

async function carregarNegocio() {
  if (negocioId) return negocioId;
  const { data, error } = await supabase.from("negocios").select("id").eq("slug", c.slug).single();
  if (error || !data) throw error ?? new Error("negócio não encontrado");
  negocioId = data.id as string;
  return negocioId;
}

/** Troca os serviços do JSON (fallback) pelos que a profissional edita no painel. */
async function carregarServicos() {
  try {
    const id = await carregarNegocio();
    const { data, error } = await supabase
      .from("servicos")
      .select("nome,descricao,preco,duracao_min")
      .eq("negocio_id", id)
      .order("ordem");
    if (error || !data?.length) return;
    servicos = data as Servico[];
    const marcados = new Set(selecionados());
    opcoesEl.innerHTML = servicos
      .map(
        (s) => `<label class="opcao"><input type="checkbox" name="servico" value="${escapeHtml(s.nome)}" ${marcados.has(s.nome) ? "checked" : ""} />
          <span class="opcao-nome">${escapeHtml(s.nome)}</span>
          <span class="opcao-meta">${formatarDuracao(s.duracao_min)}</span>
          <span class="opcao-preco">${formatarPreco(s.preco)}</span></label>`,
      )
      .join("");
    const lista = document.getElementById("lista-servicos");
    if (lista) {
      lista.innerHTML = servicos
        .map(
          (s) => `<article class="card"><h3>${escapeHtml(s.nome)}</h3>
            ${s.descricao ? `<p>${escapeHtml(s.descricao)}</p>` : ""}
            <div class="meta"><strong>${formatarPreco(s.preco)}</strong><span>${formatarDuracao(s.duracao_min)}</span></div></article>`,
        )
        .join("");
    }
    if (dataEl.value) carregarDia();
  } catch {
    /* mantém os serviços do JSON */
  }
}

function selecionados() {
  return [...form.querySelectorAll<HTMLInputElement>('input[name="servico"]:checked')].map((i) => i.value);
}

function duracaoEscolhida() {
  const sel = selecionados();
  return servicos.filter((s) => sel.includes(s.nome)).reduce((t, s) => t + s.duracao_min, 0) || 60;
}

function atualizarResumo() {
  const sel = servicos.filter((s) => selecionados().includes(s.nome));
  resumoEl.hidden = !sel.length;
  if (!sel.length) return;
  const preco = sel.reduce((t, s) => t + (s.preco ?? 0), 0);
  resumoEl.textContent = `Total: ${formatarDuracao(duracaoEscolhida())}${preco ? " · " + formatarPreco(preco) : ""}`;
}

function mostrarHorarios() {
  mensagem("");
  atualizarResumo();
  if (!dia) return opcoes([], "Escolha a data primeiro");
  if (!selecionados().length) return opcoes([], "Escolha o serviço primeiro");
  if (dia.bloqueado || !dia.janelas.length) {
    opcoes([], "Sem atendimento");
    return mensagem("Não há atendimento neste dia. Escolha outra data.");
  }
  const ehHoje = dataEl.value === dataEl.min;
  const agora = new Date().getHours() * 60 + new Date().getMinutes();
  const duracao = duracaoEscolhida();

  const livres = dia.janelas
    .flatMap((j) => gerarSlots(j.inicio, j.fim, j.passo_min, duracao, dia!.ocupados))
    .filter((h) => !ehHoje || toMin(h) > agora)
    .sort();

  if (!livres.length) {
    opcoes([], "Sem horários");
    return mensagem("Não há horário livre para este serviço neste dia. Escolha outra data ou outro serviço.");
  }
  opcoes(livres, "Escolha o horário");
}

async function carregarDia() {
  if (!dataEl.value) {
    dia = null;
    return mostrarHorarios();
  }
  opcoes([], "Carregando...");
  try {
    const id = await carregarNegocio();
    const [a, m, d] = dataEl.value.split("-").map(Number);
    const [disp, bloqueado, ocupados] = await Promise.all([
      supabase.from("disponibilidade").select("inicio,fim,passo_min").eq("negocio_id", id).eq("dia_semana", new Date(a, m - 1, d).getDay()),
      supabase.rpc("dia_bloqueado", { p_negocio: id, p_data: dataEl.value }),
      supabase.rpc("horarios_ocupados", { p_negocio: id, p_data: dataEl.value }),
    ]);
    if (disp.error || bloqueado.error || ocupados.error) throw new Error("falha ao consultar");
    dia = { janelas: disp.data, bloqueado: !!bloqueado.data, ocupados: ocupados.data };
    mostrarHorarios();
  } catch {
    dia = null;
    opcoes([], "Indisponível");
    mensagem("Não foi possível carregar os horários agora. Fale com a gente pelo WhatsApp.");
  }
}

dataEl.addEventListener("change", carregarDia);
opcoesEl.addEventListener("change", mostrarHorarios);
horaEl.addEventListener("change", () => (botao.disabled = !horaEl.value));
opcoes([], "Escolha a data primeiro");
carregarServicos();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(form);
  botao.disabled = true;
  botao.textContent = "Enviando...";
  mensagem("");
  try {
    const id = await carregarNegocio();
    const pedido = {
      negocio_id: id,
      servicos: selecionados(),
      servico: selecionados().join(" + "),
      nome_cliente: String(f.get("nome")).trim(),
      telefone: String(f.get("telefone")).trim(),
      data: String(f.get("data")),
      hora: String(f.get("hora")),
    };
    const { error } = await supabase.from("agendamentos").insert(pedido);
    if (error) {
      // 23P01 = sobreposição de horário, 23505 = mesmo horário
      if (error.code === "23P01" || error.code === "23505") {
        mensagem("Esse horário acabou de ser reservado por outra pessoa. Escolha outro.");
        await carregarDia();
      } else {
        mensagem("Não foi possível enviar o pedido. Tente de novo ou fale pelo WhatsApp.");
      }
      return;
    }
    const texto = `Olá! Sou ${pedido.nome_cliente} e acabei de pedir: ${pedido.servico} no dia ${formatarData(pedido.data)} às ${pedido.hora}.`;
    const link = sucesso.querySelector<HTMLAnchorElement>("a")!;
    link.href = `https://wa.me/${c.whatsapp}?text=${encodeURIComponent(texto)}`;
    sucesso.hidden = false;
    form.hidden = true;
  } finally {
    botao.textContent = "Solicitar horário";
    botao.disabled = !horaEl.value;
  }
});
