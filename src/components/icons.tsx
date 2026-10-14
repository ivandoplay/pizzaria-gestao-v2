/**
 * Conjunto de ícones do sistema — SVG inline, traço de 1,75 px.
 *
 * Sem biblioteca externa e sem rede: os ícones vêm no próprio bundle, então
 * funcionam no computador do balcão, no tablet e até sem internet.
 * A cor segue o texto (`currentColor`), o que mantém tudo consistente.
 */

import type { ReactNode, SVGProps } from 'react'

export type NomeIcone =
  | 'painel'
  | 'caixa'
  | 'mesas'
  | 'entrega'
  | 'cardapio'
  | 'equipe'
  | 'relatorios'
  | 'historico'
  | 'cofre'
  | 'auditoria'
  | 'config'
  | 'sair'
  | 'mais'
  | 'menos'
  | 'fechar'
  | 'busca'
  | 'check'
  | 'alerta'
  | 'info'
  | 'relogio'
  | 'imprimir'
  | 'atualizar'
  | 'lixeira'
  | 'lapis'
  | 'filtro'
  | 'baixar'
  | 'seta-direita'
  | 'seta-esquerda'
  | 'seta-baixo'
  | 'seta-cima'
  | 'usuario'
  | 'dinheiro'
  | 'cartao'
  | 'qr'
  | 'sacola'
  | 'pizza'
  | 'bebida'
  | 'lanche'
  | 'talheres'
  | 'calendario'
  | 'telefone'
  | 'local'
  | 'nuvem-off'
  | 'nuvem-check'
  | 'raio'
  | 'troca'
  | 'lista'
  | 'mesa'
  | 'cadeado'
  | 'porcentagem'
  | 'soma'
  | 'olho'
  | 'olho-fechado'

const CAMINHOS: Record<NomeIcone, ReactNode> = {
  painel: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
    </>
  ),
  caixa: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M7.5 8.5h9" />
      <path d="M8 12h2.5M8 15.5h2.5M13.5 12H16M13.5 15.5H16" />
    </>
  ),
  mesas: (
    <>
      <path d="M3 9.5h18" />
      <path d="M5.5 9.5V6.8A1.8 1.8 0 0 1 7.3 5h9.4a1.8 1.8 0 0 1 1.8 1.8v2.7" />
      <path d="M7 9.5V19M17 9.5V19" />
    </>
  ),
  entrega: (
    <>
      <circle cx="5.5" cy="17.5" r="2.5" />
      <circle cx="18.5" cy="17.5" r="2.5" />
      <path d="M8 17.5h8" />
      <path d="M16 17.5l-2.2-7.2a1.6 1.6 0 0 0-1.5-1.1H10" />
      <path d="M4 13.5V11a2 2 0 0 1 2-2h2.5" />
      <path d="M13.5 8.5H18l2 4.5" />
    </>
  ),
  cardapio: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H5.5A1.5 1.5 0 0 1 4 15.5z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h4.5A1.5 1.5 0 0 0 20 15.5z" />
    </>
  ),
  equipe: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c0-2.8 2.5-5 5.5-5s5.5 2.2 5.5 5" />
      <path d="M16 5.6a3 3 0 0 1 0 5.6" />
      <path d="M17.5 14.8c2 .6 3.4 2.3 3.4 4.4" />
    </>
  ),
  relatorios: (
    <>
      <path d="M4 20h16" />
      <path d="M6.5 20V11.5" />
      <path d="M11.5 20V5.5" />
      <path d="M16.5 20v-6" />
    </>
  ),
  historico: (
    <>
      <path d="M6 3h12a1.5 1.5 0 0 1 1.5 1.5v15L15.5 18l-3.5 1.5L8.5 18 6 19.5V4.5A1.5 1.5 0 0 1 6 3z" />
      <path d="M9 8h6M9 11.5h6" />
    </>
  ),
  cofre: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 8.8V7M12 17v-1.2M15.2 12H17M7 12h1.2" />
    </>
  ),
  auditoria: (
    <>
      <path d="M12 3.5l7 2.6v5.4c0 4.1-2.8 7.4-7 9-4.2-1.6-7-4.9-7-9V6.1z" />
      <path d="M9 12.2l2 2 4-4.2" />
    </>
  ),
  config: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.9 7.5l1.9 1.1M17.2 15.4l1.9 1.1M4.9 16.5l1.9-1.1M17.2 8.6l1.9-1.1" />
    </>
  ),
  sair: (
    <>
      <path d="M15 5.5V4.8A1.8 1.8 0 0 0 13.2 3H6.3A1.8 1.8 0 0 0 4.5 4.8v14.4A1.8 1.8 0 0 0 6.3 21h6.9a1.8 1.8 0 0 0 1.8-1.8v-.7" />
      <path d="M10 12h10" />
      <path d="M17 8.8l3.2 3.2L17 15.2" />
    </>
  ),
  mais: <path d="M12 5v14M5 12h14" />,
  menos: <path d="M5 12h14" />,
  fechar: <path d="M6 6l12 12M18 6L6 18" />,
  busca: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alerta: (
    <>
      <path d="M10.3 4.3L3.5 16.2A2 2 0 0 0 5.2 19h13.6a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 16.4v.1" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8.2v.1" />
    </>
  ),
  relogio: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3.2 2" />
    </>
  ),
  imprimir: (
    <>
      <path d="M7 9V4h10v5" />
      <rect x="4" y="9" width="16" height="7" rx="2" />
      <path d="M7 14h10v6H7z" />
    </>
  ),
  atualizar: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4.5V10h-5.5" />
    </>
  ),
  lixeira: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
      <path d="M6.5 7l.8 12.1A1.9 1.9 0 0 0 9.2 21h5.6a1.9 1.9 0 0 0 1.9-1.9L17.5 7" />
      <path d="M10.5 11v5.5M13.5 11v5.5" />
    </>
  ),
  lapis: (
    <>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="M14.5 5.5l4 4" />
    </>
  ),
  filtro: <path d="M4 6h16M7 12h10M10 18h4" />,
  baixar: (
    <>
      <path d="M12 4v11" />
      <path d="M8 11.5l4 4 4-4" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  'seta-direita': <path d="M9 5.5l6.5 6.5L9 18.5" />,
  'seta-esquerda': <path d="M15 5.5L8.5 12 15 18.5" />,
  'seta-baixo': <path d="M5.5 9L12 15.5 18.5 9" />,
  'seta-cima': <path d="M5.5 15L12 8.5 18.5 15" />,
  usuario: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c0-3.2 3.1-5.5 7-5.5s7 2.3 7 5.5" />
    </>
  ),
  dinheiro: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 12H5.5M18.5 12H18" />
    </>
  ),
  cartao: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
      <path d="M2.5 10h19" />
      <path d="M6 14.5h3" />
    </>
  ),
  qr: (
    <>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5" />
      <path d="M14 14h2.5v2.5H14zM18.5 18.5h2v2h-2zM14 20.5h2M20.5 14h-2.5" />
    </>
  ),
  sacola: (
    <>
      <path d="M5.5 8h13l1 12.5H4.5z" />
      <path d="M9 8V6.2A3 3 0 0 1 12 3.2a3 3 0 0 1 3 3V8" />
    </>
  ),
  pizza: (
    <>
      <path d="M12 3.5c4.7 0 8.5 3.8 8.5 8.5 0 2.6-2.9 5.5-8.5 8.5-5.6-3-8.5-5.9-8.5-8.5C3.5 7.3 7.3 3.5 12 3.5z" />
      <circle cx="10" cy="10" r="1.1" />
      <circle cx="14" cy="12.5" r="1.1" />
      <circle cx="11.5" cy="15.5" r="1.1" />
    </>
  ),
  bebida: (
    <>
      <path d="M6.5 7h11l-1.2 12.2a1.8 1.8 0 0 1-1.8 1.6H9.5a1.8 1.8 0 0 1-1.8-1.6z" />
      <path d="M7.5 12.5h9" />
      <path d="M14 7l1-4" />
    </>
  ),
  lanche: (
    <>
      <path d="M4 9.5c0-3 3.6-5.5 8-5.5s8 2.5 8 5.5" />
      <path d="M4 12.5h16" />
      <path d="M4.5 15.5h15a1 1 0 0 1 1 1v1.2a1.2 1.2 0 0 1-1.2 1.2H4.7a1.2 1.2 0 0 1-1.2-1.2v-1.2a1 1 0 0 1 1-1z" />
    </>
  ),
  talheres: (
    <>
      <path d="M7 3v7.5a2 2 0 0 0 4 0V3" />
      <path d="M9 10.5V21" />
      <path d="M16.5 3c-1.4 1.2-2 2.9-2 5.2 0 1.7.7 2.9 2 3.4V21" />
    </>
  ),
  calendario: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8.5 3.5V6M15.5 3.5V6" />
    </>
  ),
  telefone: (
    <path d="M6.6 3.5h2.2l1.6 4-2 1.4a10.5 10.5 0 0 0 5.2 5.2l1.4-2 4 1.6v2.2A2.6 2.6 0 0 1 16.3 20 15.6 15.6 0 0 1 4 7.7a2.6 2.6 0 0 1 2.6-4.2z" />
  ),
  local: (
    <>
      <path d="M12 21s6.5-5.7 6.5-10.4A6.5 6.5 0 0 0 5.5 10.6C5.5 15.3 12 21 12 21z" />
      <circle cx="12" cy="10.4" r="2.4" />
    </>
  ),
  'nuvem-off': (
    <>
      <path d="M8 18.5h9.2a4.3 4.3 0 0 0 .6-8.6A6 6 0 0 0 12.7 6 5.4 5.4 0 0 0 7.8 8.6" />
      <path d="M6.3 11.6a3.6 3.6 0 0 0 1 7.1" />
      <path d="M4 4l16 16" />
    </>
  ),
  'nuvem-check': (
    <>
      <path d="M8 18.5h9.2a4.3 4.3 0 0 0 .6-8.6A6 6 0 0 0 12.7 6 5.4 5.4 0 0 0 7.8 8.6" />
      <path d="M6.3 11.6a3.6 3.6 0 0 0 1 7.1" />
      <path d="M9.5 14.8l1.8 1.8 3.4-3.6" />
    </>
  ),
  raio: <path d="M13.5 3L5 13.5h5.5L10 21l8.6-10.6H13z" />,
  troca: (
    <>
      <path d="M4 8.5h13" />
      <path d="M13.5 5l3.5 3.5-3.5 3.5" />
      <path d="M20 15.5H7" />
      <path d="M10.5 12L7 15.5 10.5 19" />
    </>
  ),
  lista: (
    <>
      <path d="M8.5 7h11M8.5 12h11M8.5 17h11" />
      <path d="M4.5 7h.1M4.5 12h.1M4.5 17h.1" />
    </>
  ),
  mesa: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M3.5 12h17" />
      <path d="M12 12v7.5" />
    </>
  ),
  cadeado: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <path d="M12 14.5v2.5" />
    </>
  ),
  porcentagem: (
    <>
      <path d="M6 18L18 6" />
      <circle cx="7.5" cy="7.5" r="2.2" />
      <circle cx="16.5" cy="16.5" r="2.2" />
    </>
  ),
  soma: <path d="M5 5h14l-7 7 7 7H5" />,
  olho: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'olho-fechado': (
    <>
      <path d="M9.6 6.2A9.9 9.9 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-2.7 3.4" />
      <path d="M6.4 8.3A17.4 17.4 0 0 0 2.5 12S6 18.2 12 18.2c1 0 1.9-.2 2.7-.4" />
      <path d="M10 10a2.8 2.8 0 0 0 4 4" />
      <path d="M4 4l16 16" />
    </>
  ),
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  nome: NomeIcone
  className?: string
  /** Rótulo acessível. Sem ele, o ícone é decorativo (aria-hidden). */
  titulo?: string
}

export function Icon({ nome, className = 'h-5 w-5', titulo, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={titulo ? 'img' : undefined}
      aria-label={titulo}
      aria-hidden={titulo ? undefined : true}
      focusable="false"
      {...props}
    >
      {CAMINHOS[nome]}
    </svg>
  )
}
