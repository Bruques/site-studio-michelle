import c from "../config/cliente.json";
import {
  supabase, DIAS_SEMANA, hhmm, toMin, fmtMin, escapeHtml, linkWhatsApp, formatarData, formatarDuracao, formatarPreco,
} from "../lib/supabase";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const loginForm = $<HTMLFormElement>("login");
const app = $("app");
const aviso = $("painel-aviso");
const sair = $("sair");

let negocioId = "";
let filtro = "pendente";

function mostrarAviso(texto: string, ok = false) {
  aviso.textContent = texto;
  aviso.hidden = !texto;
  aviso.classList.toggle("ok", ok);
}

function hojeISO() {
  return new Date().toLocaleDateString("sv-SE");
}

async function iniciar() {
  const { data } = await supabase.auth.getSession();
  const logado = !!data.session;
  loginForm.hidden = logado;
  app.hidden = !logado;
  sair.hidden = !logado;
  if (!logado) return;

  const { data: negocio } = await supabase.from("negocios").select("id,owner_id").eq("slug", c.slug).single();
  if (!negocio || negocio.owner_id !== data.session!.user.id) {
    app.hidden = true;
    mostrarAviso("Esta conta não tem acesso a este negócio.");
    sair.hidden = false;
    return;
  }
  negocioId = negocio.id;
  mostrarAviso("");
  await Promise.all([carregarPedidos(), carregarHorarios(), carregarServicos(), carregarFolgas()]);
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(loginForm);
  const erro = $("login-erro");
  const { error } = await supabase.auth.signInWithPassword({ email: String(f.get("email")), password: String(f.get("senha")) });
  erro.hidden = !error;
  if (error) return void (erro.textContent = "E-mail ou senha incorretos.");
  loginForm.reset();
  iniciar();
});

sair.addEventListener("click", async () => {
  await supabase.auth.signOut();
  mostrarAviso("");
  iniciar();
});

document.querySelectorAll<HTMLButtonElement>(".aba").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".aba").forEach((x) => x.classList.toggle("ativa", x === b));
    for (const nome of ["pedidos", "horarios", "servicos", "folgas"]) $(`aba-${nome}`).hidden = nome !== b.dataset.aba;
    mostrarAviso("");
  }),
);

/* ---------- Pedidos ---------- */
document.querySelectorAll<HTMLButtonElement>(".filtro").forEach((b) =>
  b.addEventListener("click", () => {
    filtro = b.dataset.filtro!;
    document.querySelectorAll(".filtro").forEach((x) => x.classList.toggle("ativa", x === b));
    carregarPedidos();
  }),
);

async function carregarPedidos() {
  const { data, error } = await supabase
    .from("agendamentos")
    .select("*")
    .eq("negocio_id", negocioId)
    .eq("status", filtro)
    .gte("data", hojeISO())
    .order("data")
    .order("hora");
  const lista = $("lista-pedidos");
  if (error) return void (lista.textContent = "Erro ao carregar pedidos.");
  if (!data.length) return void (lista.innerHTML = `<p class="vazio">Nenhum pedido ${filtro === "pendente" ? "pendente" : filtro}.</p>`);
  lista.innerHTML = data
    .map((p) => {
      const fim = fmtMin(toMin(p.hora) + p.duracao_min);
      const msg = `Olá ${p.nome_cliente}! Seu horário de ${p.servico} está confirmado para ${formatarData(p.data)} às ${hhmm(p.hora)}. Te espero! 🤎`;
      return `<article class="cartao pedido">
        <div class="pedido-info">
          <span class="pedido-quando">${formatarData(p.data)} · ${hhmm(p.hora)}–${fim}</span>
          <span class="pedido-servico">${escapeHtml(p.servico)}</span>
          <span class="pedido-cliente">${escapeHtml(p.nome_cliente)}${p.telefone ? " · " + escapeHtml(p.telefone) : ""}</span>
        </div>
        <div class="acoes">
          ${p.status === "pendente" ? `<button class="btn btn-pequeno" data-id="${p.id}" data-status="confirmado">Confirmar</button>` : ""}
          ${p.telefone ? `<a class="btn btn-pequeno btn-contorno" target="_blank" rel="noopener" href="${linkWhatsApp(p.telefone, msg)}">WhatsApp</a>` : ""}
          ${p.status !== "cancelado" ? `<button class="btn btn-pequeno btn-perigo" data-id="${p.id}" data-status="cancelado">Cancelar</button>` : ""}
        </div>
      </article>`;
    })
    .join("");
}

$("lista-pedidos").addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-id]");
  if (!b) return;
  if (b.dataset.status === "cancelado" && !confirm("Cancelar este pedido? O horário volta a ficar livre.")) return;
  const { error } = await supabase.from("agendamentos").update({ status: b.dataset.status }).eq("id", b.dataset.id!);
  mostrarAviso(error ? "Não foi possível atualizar o pedido." : "");
  carregarPedidos();
});

/* ---------- Horários semanais ---------- */
async function carregarHorarios() {
  const { data } = await supabase.from("disponibilidade").select("*").eq("negocio_id", negocioId);
  const porDia = new Map((data ?? []).map((d) => [d.dia_semana as number, d]));
  $<HTMLSelectElement>("passo").value = String(data?.[0]?.passo_min ?? 30);
  $("lista-horarios").innerHTML = [1, 2, 3, 4, 5, 6, 0]
    .map((dia) => {
      const d = porDia.get(dia);
      return `<div class="dia-linha ${d ? "on" : ""}" data-dia="${dia}">
        <label class="interruptor">
          <input type="checkbox" class="ativo" ${d ? "checked" : ""}>
          <span class="trilho"></span>
          <span class="dia-nome">${DIAS_SEMANA[dia]}</span>
        </label>
        <div class="faixa">
          <input type="time" class="inicio" value="${d ? hhmm(d.inicio) : "09:00"}">
          <span>até</span>
          <input type="time" class="fim" value="${d ? hhmm(d.fim) : "18:00"}">
        </div>
      </div>`;
    })
    .join("");
}

$("lista-horarios").addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.classList.contains("ativo")) t.closest(".dia-linha")!.classList.toggle("on", t.checked);
});

$("salvar-horarios").addEventListener("click", async () => {
  const passo = Number($<HTMLSelectElement>("passo").value);
  const novos = [...document.querySelectorAll<HTMLElement>(".dia-linha.on")].map((l) => ({
    negocio_id: negocioId,
    dia_semana: Number(l.dataset.dia),
    inicio: l.querySelector<HTMLInputElement>(".inicio")!.value,
    fim: l.querySelector<HTMLInputElement>(".fim")!.value,
    passo_min: passo,
  }));
  if (novos.some((n) => !n.inicio || !n.fim || n.fim <= n.inicio)) {
    return mostrarAviso("O horário final precisa ser depois do inicial.");
  }
  const del = await supabase.from("disponibilidade").delete().eq("negocio_id", negocioId);
  const ins = novos.length ? await supabase.from("disponibilidade").insert(novos) : { error: null };
  const erro = del.error || ins.error;
  mostrarAviso(erro ? "Erro ao salvar os horários." : "Horários salvos!", !erro);
  carregarHorarios();
});

/* ---------- Serviços ---------- */
type ServicoDB = { id: string; nome: string; descricao: string | null; preco: number | null; duracao_min: number; ordem: number; ativo: boolean };

function opcoesDuracao(selecionada: number) {
  const valores = new Set<number>();
  for (let m = 15; m <= 360; m += 15) valores.add(m);
  valores.add(selecionada);
  return [...valores]
    .sort((a, b) => a - b)
    .map((m) => `<option value="${m}" ${m === selecionada ? "selected" : ""}>${formatarDuracao(m)}</option>`)
    .join("");
}

$("duracao-novo").innerHTML = opcoesDuracao(60);

let servicos: ServicoDB[] = [];

async function carregarServicos() {
  const { data, error } = await supabase.from("servicos").select("*").eq("negocio_id", negocioId).order("ordem");
  const lista = $("lista-servicos-painel");
  if (error) return void (lista.textContent = "Erro ao carregar serviços.");
  servicos = data as ServicoDB[];
  lista.innerHTML = servicos.length
    ? servicos
        .map(
          (s) => `<article class="cartao servico ${s.ativo ? "" : "inativo"}" data-id="${s.id}">
        <div class="grade-servico">
          <label class="campo nome">Nome <input class="f-nome" value="${escapeHtml(s.nome)}"></label>
          <label class="campo">Preço (R$) <input class="f-preco" type="number" min="0" step="0.01" value="${s.preco ?? ""}"></label>
          <label class="campo">Duração <select class="f-dur">${opcoesDuracao(s.duracao_min)}</select></label>
          <label class="campo larga">Descrição <input class="f-desc" value="${escapeHtml(s.descricao ?? "")}"></label>
        </div>
        <div class="acoes">
          <button class="btn btn-pequeno" data-acao="salvar">Salvar</button>
          <button class="btn btn-pequeno btn-contorno" data-acao="ativo">${s.ativo ? "Ocultar do site" : "Mostrar no site"}</button>
          <button class="btn btn-pequeno btn-perigo" data-acao="remover">Remover</button>
        </div>
      </article>`,
        )
        .join("")
    : `<p class="vazio">Nenhum serviço cadastrado.</p>`;
}

$("lista-servicos-painel").addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-acao]");
  if (!b) return;
  const card = b.closest<HTMLElement>(".servico")!;
  const id = card.dataset.id!;
  const atual = servicos.find((s) => s.id === id)!;
  let erro: unknown = null;

  if (b.dataset.acao === "salvar") {
    const nome = card.querySelector<HTMLInputElement>(".f-nome")!.value.trim();
    if (!nome) return mostrarAviso("O serviço precisa de um nome.");
    const preco = card.querySelector<HTMLInputElement>(".f-preco")!.value;
    ({ error: erro } = await supabase.from("servicos").update({
      nome,
      preco: preco === "" ? null : Number(preco),
      duracao_min: Number(card.querySelector<HTMLSelectElement>(".f-dur")!.value),
      descricao: card.querySelector<HTMLInputElement>(".f-desc")!.value.trim() || null,
    }).eq("id", id));
  } else if (b.dataset.acao === "ativo") {
    ({ error: erro } = await supabase.from("servicos").update({ ativo: !atual.ativo }).eq("id", id));
  } else if (b.dataset.acao === "remover") {
    if (!confirm(`Remover "${atual.nome}"? Pedidos antigos continuam salvos.`)) return;
    ({ error: erro } = await supabase.from("servicos").delete().eq("id", id));
  }
  mostrarAviso(erro ? "Não foi possível salvar." : "Serviço atualizado!", !erro);
  carregarServicos();
});

$<HTMLFormElement>("form-servico").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const f = new FormData(form);
  const preco = String(f.get("preco"));
  const { error } = await supabase.from("servicos").insert({
    negocio_id: negocioId,
    nome: String(f.get("nome")).trim(),
    preco: preco === "" ? null : Number(preco),
    duracao_min: Number(f.get("duracao")),
    descricao: String(f.get("descricao")).trim() || null,
    ordem: Math.max(0, ...servicos.map((s) => s.ordem)) + 1,
  });
  mostrarAviso(error ? "Não foi possível adicionar o serviço." : "Serviço adicionado!", !error);
  if (!error) form.reset();
  carregarServicos();
});

/* ---------- Folgas ---------- */
async function carregarFolgas() {
  const { data } = await supabase.from("bloqueios").select("*").eq("negocio_id", negocioId).gte("data", hojeISO()).order("data");
  $("lista-folgas").innerHTML = data?.length
    ? data
        .map(
          (b) => `<article class="cartao pedido"><div class="pedido-info">
          <span class="pedido-quando">${formatarData(b.data)}</span>
          <span class="pedido-servico">${b.hora ? `${hhmm(b.hora)} às ${hhmm(b.hora_fim ?? b.hora)}` : "Dia inteiro"}</span>
          ${b.motivo ? `<span class="pedido-cliente">${escapeHtml(b.motivo)}</span>` : ""}</div>
          <div class="acoes"><button class="btn btn-pequeno btn-perigo" data-del="${b.id}">Remover</button></div></article>`,
        )
        .join("")
    : `<p class="vazio">Nenhuma folga cadastrada.</p>`;
}

$<HTMLFormElement>("form-folga").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const f = new FormData(form);
  const inicio = String(f.get("inicio"));
  const fim = String(f.get("fim"));
  if (!!inicio !== !!fim) return mostrarAviso("Preencha o início e o fim, ou deixe os dois em branco para fechar o dia inteiro.");
  if (inicio && fim <= inicio) return mostrarAviso("O horário final precisa ser depois do inicial.");
  const { error } = await supabase.from("bloqueios").insert({
    negocio_id: negocioId,
    data: String(f.get("data")),
    hora: inicio || null,
    hora_fim: fim || null,
    motivo: String(f.get("motivo")).trim() || null,
  });
  mostrarAviso(error ? "Não foi possível salvar a folga." : "Folga salva!", !error);
  if (!error) form.reset();
  carregarFolgas();
});

$("lista-folgas").addEventListener("click", async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-del]");
  if (!b) return;
  await supabase.from("bloqueios").delete().eq("id", b.dataset.del!);
  carregarFolgas();
});

iniciar();
