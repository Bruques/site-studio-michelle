const alvos = document.querySelectorAll(".reveal, .reveal-grupo");
const reduzir = matchMedia("(prefers-reduced-motion: reduce)").matches;

if (reduzir || !("IntersectionObserver" in window)) {
  alvos.forEach((el) => el.classList.add("visivel"));
} else {
  const io = new IntersectionObserver(
    (entradas) =>
      entradas.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("visivel");
        io.unobserve(e.target);
      }),
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
  );
  alvos.forEach((el) => io.observe(el));
}

// Realce do link do menu conforme a seção visível
const links = document.querySelectorAll<HTMLAnchorElement>(".topo nav a:not(.btn)");
const secoes = [...links].map((a) => document.querySelector(a.getAttribute("href")!));
const spy = new IntersectionObserver(
  (entradas) =>
    entradas.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => a.classList.toggle("atual", a.getAttribute("href") === `#${e.target.id}`));
    }),
  { rootMargin: "-45% 0px -50% 0px" },
);
secoes.forEach((s) => s && spy.observe(s));
