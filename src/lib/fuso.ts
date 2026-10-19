/**
 * Fuso da operação — um só lugar para as telas perguntarem.
 *
 * A fonte é `business_settings.timezone` (Configurações). Enquanto a consulta
 * não chega, ou se o banco faltar, vale o valor do build (`VITE_TIMEZONE`).
 * Assistir no hook garante que mudar o fuso em Configurações reorganize a
 * virada do dia nas telas (antes: cada tela usava só o fuso do build e o
 * "Hoje" continuava no fuso antigo até o próximo deploy — pendência aberta da
 * correção A10).
 */
import { TIMEZONE } from './env'
import { useSettings } from './hooks'

export const FUSO_PADRAO = TIMEZONE

export function useFusoOperacao(): string {
  const settings = useSettings()
  return settings.data?.timezone?.trim() || FUSO_PADRAO
}
