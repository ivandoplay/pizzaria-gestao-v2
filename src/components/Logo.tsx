/**
 * Emblema da casa — fatia de pizza dentro de um anel.
 *
 * Por que existe um componente só: a marca aparece na tela de entrada, na
 * lateral do sistema e no ícone da aba do navegador. Desenhada em vetor, ela
 * fica nítida em qualquer tamanho (do ícone de 16 px ao painel da entrada) e
 * pesa quase nada — nada de imagem para baixar, que é o que o balcão não pode.
 *
 * Técnica: formas chapadas com traço grosso, sem sombra e sem degradê. É o
 * mesmo vocabulário da interface (cartões de borda fina, cores por função) e
 * aguenta ser impresso, bordado em avental e reduzido a 16 px.
 *
 * Cores: só as da identidade — `brand` para a massa e o anel, tomate maduro,
 * mussarela em tom de papel e um verde de manjericão para o único acento
 * vegetal. Nada de cor nova inventada para a marca.
 */
export function Emblema({
  className = 'h-9 w-9',
  titulo,
}: {
  className?: string
  /** Se informado, o emblema é lido por leitor de tela com este nome. */
  titulo?: string
}) {
  return (
    /* svg:inicio */
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={titulo ? 'img' : undefined}
      aria-label={titulo}
      aria-hidden={titulo ? undefined : true}
      focusable="false"
    >
      {/* anel */}
      <circle cx="32" cy="32" r="29" fill="none" stroke="#a32d18" strokeWidth="2.6" />
      {/* massa */}
      <path d="M32 53.5 L15.4 22.2 A33 33 0 0 1 48.6 22.2 Z" fill="#c43a20" />
      {/* borda assada */}
      <path
        d="M19.2 25.2 A30.4 30.4 0 0 1 44.8 25.2"
        fill="none"
        stroke="#872716"
        strokeWidth="4.4"
        strokeLinecap="round"
      />
      {/* mussarela cobrindo quase toda a fatia (é o que dá o desenho à pizza) */}
      <path d="M32 51 L17.6 25 A28 28 0 0 1 46.4 25 Z" fill="#fdf7f0" />
      {/* tomate */}
      <circle cx="24.5" cy="30.5" r="3.9" fill="#a32d18" />
      <circle cx="39.5" cy="30.5" r="3.9" fill="#a32d18" />
      <circle cx="32" cy="42" r="4" fill="#a32d18" />
      {/* manjericão (único verde da marca) */}
      <path
        d="M30.2 36.6 C 33.2 34.6 35.4 31 36.4 26.4 C 31.8 28.4 29.8 32.2 30.2 36.6 Z"
        fill="#4a7f42"
      />
      <path
        d="M31.4 35.2 C 33 32.6 34.6 30 35.6 27.2"
        fill="none"
        stroke="#fdf7f0"
        strokeWidth="0.9"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
    /* svg:fim */
  )
}

/**
 * Emblema sobre uma placa clara. No painel vermelho da entrada e na lateral
 * escura do sistema a marca precisa de um fundo claro por baixo — senão o
 * vermelho do anel some no vermelho do painel.
 */
export function EmblemaEmPlaca({
  className = 'h-12 w-12',
  raio = 'rounded-2xl',
  titulo,
}: {
  className?: string
  raio?: string
  titulo?: string
}) {
  return (
    <span
      className={`flex items-center justify-center bg-[#fdf7f0] shadow-[0_1px_0_rgba(255,255,255,0.35)_inset,0_10px_24px_-12px_rgba(18,17,16,0.55)] ring-1 ring-black/5 ${raio} ${className}`}
    >
      <Emblema className="h-[72%] w-[72%]" titulo={titulo} />
    </span>
  )
}
