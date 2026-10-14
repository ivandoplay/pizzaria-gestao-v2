import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { useBusinessHours, usePaymentMethods, useSettings, useZones } from '../lib/hooks'
import * as api from '../lib/api'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  Field,
  IconButton,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from '../components/ui'
import { formatMoney, parseMoneyToCents } from '../lib/format'
import { translateError } from '../lib/errors'
import { ROLE_LABELS, type BusinessSettings, type DeliveryFeeZone, type PaymentMethod } from '../lib/types'

const TIMEZONES = [
  'America/Fortaleza',
  'America/Sao_Paulo',
  'America/Belem',
  'America/Recife',
  'America/Bahia',
  'America/Manaus',
  'America/Cuiaba',
  'America/Rio_Branco',
]

const WEEKDAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado']

/** Tipos de pagamento aceitos pelo banco, com o nome que o operador lê. */
const TIPOS_PAGAMENTO: { valor: PaymentMethod['kind']; rotulo: string }[] = [
  { valor: 'cash', rotulo: 'Dinheiro' },
  { valor: 'pix', rotulo: 'Pix' },
  { valor: 'debit_card', rotulo: 'Cartão de débito' },
  { valor: 'credit_card', rotulo: 'Cartão de crédito' },
  { valor: 'other', rotulo: 'Outro' },
]

export default function SettingsPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { profile } = useAuth()
  const settings = useSettings()
  const methods = usePaymentMethods(false)
  const zones = useZones()
  const hours = useBusinessHours()

  const [draft, setDraft] = useState<BusinessSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [zoneForm, setZoneForm] = useState<null | Partial<DeliveryFeeZone>>(null)
  const [methodForm, setMethodForm] = useState<null | PaymentMethod>(null)

  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data)
  }, [draft, settings.data])

  /** Há alterações digitadas que ainda não foram gravadas? */
  const sujo = useMemo(
    () => Boolean(draft && settings.data && JSON.stringify(draft) !== JSON.stringify(settings.data)),
    [draft, settings.data],
  )

  async function saveSettings() {
    if (!draft) return
    setBusy(true)
    try {
      await api.saveSettings({
        trade_name: draft.trade_name,
        legal_name: draft.legal_name,
        phone: draft.phone,
        address_line: draft.address_line,
        logo_url: draft.logo_url,
        timezone: draft.timezone,
        pix_key: draft.pix_key,
        accept_delivery: draft.accept_delivery,
        accept_dine_in: draft.accept_dine_in,
        default_delivery_fee_cents: draft.default_delivery_fee_cents,
        min_delivery_order_cents: draft.min_delivery_order_cents,
        half_and_half_price_rule: draft.half_and_half_price_rule,
        max_discount_pct_without_auth: draft.max_discount_pct_without_auth,
        max_discount_pct_hard: draft.max_discount_pct_hard,
        cash_variance_tolerance_cents: draft.cash_variance_tolerance_cents,
        split_payment_enabled: draft.split_payment_enabled,
        receipt_footer_text: draft.receipt_footer_text,
      })
      toast.success('Configurações salvas e registradas na auditoria.')
      setDraft(null)
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    } catch (error) {
      toast.error(translateError(error))
    } finally {
      setBusy(false)
    }
  }

  if (settings.isLoading || !draft) return <LoadingBlock label="Carregando configurações…" linhas={6} />

  return (
    <div>
      <PageHeader
        titulo="Configurações"
        descricao="Dados da pizzaria, formas de pagamento, bairros atendidos e horários. Toda alteração fica registrada na auditoria."
        selo={sujo ? <Badge tone="amber" ponto>alterações não salvas</Badge> : undefined}
        acoes={
          <>
            <Button
              variant="secondary"
              icone="troca"
              onClick={() => settings.data && setDraft(settings.data)}
              disabled={busy || !sujo}
            >
              Descartar
            </Button>
            <Button icone="check" onClick={saveSettings} loading={busy} disabled={!sujo}>
              Salvar configurações
            </Button>
          </>
        }
      />

      <Card
        title="Dados da pizzaria"
        icone="config"
        descricao="Estes dados aparecem no topo dos comprovantes impressos."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Nome fantasia *">
            <Input value={draft.trade_name} onChange={(event) => setDraft({ ...draft, trade_name: event.target.value })} />
          </Field>
          <Field label="Razão social">
            <Input value={draft.legal_name ?? ''} onChange={(event) => setDraft({ ...draft, legal_name: event.target.value })} />
          </Field>
          <Field label="Telefone">
            <Input value={draft.phone ?? ''} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
          </Field>
          <Field label="Endereço" className="sm:col-span-2">
            <Input value={draft.address_line ?? ''} onChange={(event) => setDraft({ ...draft, address_line: event.target.value })} />
          </Field>
          <Field label="Chave Pix" hint="Usada apenas como informação no comprovante.">
            <Input value={draft.pix_key ?? ''} onChange={(event) => setDraft({ ...draft, pix_key: event.target.value })} />
          </Field>
          <Field label="Fuso horário *" hint="Afeta agrupamentos de relatórios e datas de fechamento.">
            <Select value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}>
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="URL do logo" className="sm:col-span-2" hint="Opcional — imagem hospedada no Supabase Storage.">
            <Input value={draft.logo_url ?? ''} onChange={(event) => setDraft({ ...draft, logo_url: event.target.value })} />
          </Field>
          <Field label="Rodapé do comprovante" className="sm:col-span-3">
            <Textarea
              value={draft.receipt_footer_text ?? ''}
              onChange={(event) => setDraft({ ...draft, receipt_footer_text: event.target.value })}
              placeholder="ex.: obrigado pela preferência! Pedidos: (86) 99999-0000"
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2 rounded-md border border-ink-200 p-3">
            <Checkbox
              label="Aceita salão (mesas)"
              checked={draft.accept_dine_in}
              onChange={(checked) => setDraft({ ...draft, accept_dine_in: checked })}
            />
            <Checkbox
              label="Aceita delivery"
              checked={draft.accept_delivery}
              onChange={(checked) => setDraft({ ...draft, accept_delivery: checked })}
            />
            <Checkbox
              label="Pagamento dividido"
              checked={draft.split_payment_enabled}
              onChange={(checked) => setDraft({ ...draft, split_payment_enabled: checked })}
            />
          </div>
          <CampoDinheiro
            label="Taxa de entrega padrão (R$)"
            cents={draft.default_delivery_fee_cents}
            onChange={(valor) => setDraft({ ...draft, default_delivery_fee_cents: valor })}
          />
          <CampoDinheiro
            label="Pedido mínimo para delivery (R$)"
            hint="Abaixo deste valor o pedido não pode ser lançado no delivery."
            cents={draft.min_delivery_order_cents}
            onChange={(valor) => setDraft({ ...draft, min_delivery_order_cents: valor })}
          />
          <Field label="Regra do meio a meio" hint="Como cobrar pizza com dois sabores.">
            <Select
              value={draft.half_and_half_price_rule}
              onChange={(event) =>
                setDraft({ ...draft, half_and_half_price_rule: event.target.value as 'highest' | 'average' })
              }
            >
              <option value="highest">Cobrar o sabor mais caro</option>
              <option value="average">Cobrar a média dos sabores</option>
            </Select>
          </Field>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Field label="Desconto máximo do caixa (%)" hint="Acima disso o sistema exige autorização do administrador.">
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.max_discount_pct_without_auth}
              onChange={(event) => setDraft({ ...draft, max_discount_pct_without_auth: Number(event.target.value) })}
            />
          </Field>
          <Field label="Teto absoluto de desconto (%)" hint="Nunca ultrapassado — nem pelo administrador.">
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.max_discount_pct_hard}
              onChange={(event) => setDraft({ ...draft, max_discount_pct_hard: Number(event.target.value) })}
            />
          </Field>
          <CampoDinheiro
            label="Tolerância de divergência de caixa (R$)"
            hint="Diferenças acima disso exigem justificativa no fechamento."
            cents={draft.cash_variance_tolerance_cents}
            onChange={(valor) => setDraft({ ...draft, cash_variance_tolerance_cents: valor })}
          />
        </div>

        <p className="mt-3 text-[11px] text-ink-400">
          Versão do sistema em uso: <span className="text-ink-600">{__VERSAO_DO_APP__}</span> — se algum aparelho
          mostrar um número diferente, ele está com uma versão antiga aberta (recarregue a página).
        </p>
        <p className="mt-2 text-[11px] text-ink-500">
          Toda alteração de configuração é registrada na auditoria com o valor anterior e o novo. Perfil atual:{' '}
          <strong className="text-ink-700">{profile?.full_name}</strong>{' '}
          {profile && profile.login && <span className="text-ink-500">({profile.login})</span>}{' '}
          {profile &&
            ROLE_LABELS[profile.role].toLowerCase() !== (profile.full_name ?? '').toLowerCase() && (
              <Badge tone="brand">{ROLE_LABELS[profile.role]}</Badge>
            )}
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Formas de pagamento"
          icone="dinheiro"
          descricao="Pix, cartão e dinheiro são registrados manualmente pelo operador."
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setMethodForm({
                  id: '',
                  label: '',
                  kind: 'other',
                  affects_cash_drawer: false,
                  requires_change: false,
                  allows_prepaid: false,
                  is_active: true,
                  is_default: false,
                  sort_order: (methods.data?.length ?? 0) * 10,
                })
              }
            >
              + Nova forma
            </Button>
          }
        >
          <DataTable
            minW="min-w-0"
            tamanho="compacto"
            rows={methods.data ?? []}
            rowKey={(row) => row.id}
            emptyMessage="Nenhuma forma cadastrada."
            columns={[
              { key: 'label', header: 'Forma', render: (row) => <span className="font-medium text-ink-800">{row.label}</span> },
              {
                key: 'kind',
                header: 'Tipo',
                render: (row) => (
                  <span className="text-xs text-ink-600">
                    {TIPOS_PAGAMENTO.find((tipo) => tipo.valor === row.kind)?.rotulo ?? row.kind}
                  </span>
                ),
              },
              {
                key: 'flags',
                header: 'Comportamento',
                render: (row) => (
                  <div className="flex flex-wrap gap-1">
                    {row.affects_cash_drawer && <Badge tone="green">gaveta</Badge>}
                    {row.requires_change && <Badge tone="amber">troco</Badge>}
                    {row.allows_prepaid && <Badge tone="blue">antecipado</Badge>}
                    {!row.is_active && <Badge tone="slate">inativa</Badge>}
                  </div>
                ),
              },
              {
                key: 'actions',
                header: '',
                align: 'right',
                render: (row) => (
                  <Button size="sm" variant="ghost" onClick={() => setMethodForm(row)}>
                    Editar
                  </Button>
                ),
              },
            ]}
          />
          <p className="mt-2 text-[11px] text-ink-500">
            Pix, cartão e dinheiro são <strong>registrados manualmente</strong> pelo operador. Não há integração com
            adquirentes nem conciliação automática nesta versão.
          </p>
        </Card>

        <Card
          title="Bairros e taxas de entrega"
          icone="local"
          descricao="A taxa do bairro tem prioridade sobre a taxa padrão."
          actions={
            <Button size="sm" variant="secondary" onClick={() => setZoneForm({ neighborhood: '', fee_cents: 0, is_active: true })}>
              + Novo bairro
            </Button>
          }
        >
          {(zones.data ?? []).length === 0 ? (
            <EmptyState
              title="Nenhum bairro cadastrado"
              description="Sem bairros, o delivery usa a taxa padrão das configurações."
            />
          ) : (
            <DataTable
              minW="min-w-0"
              tamanho="compacto"
              rows={zones.data ?? []}
              rowKey={(row) => row.id}
              columns={[
                { key: 'neighborhood', header: 'Bairro', render: (row) => row.neighborhood },
                { key: 'fee', header: 'Taxa', align: 'right', render: (row) => formatMoney(row.fee_cents) },
                {
                  key: 'status',
                  header: 'Situação',
                  render: (row) => <Badge tone={row.is_active ? 'green' : 'slate'}>{row.is_active ? 'Ativo' : 'Inativo'}</Badge>,
                },
                {
                  key: 'actions',
                  header: '',
                  align: 'right',
                  render: (row) => (
                    <IconButton nome="lapis" titulo={`Editar ${row.neighborhood}`} size="sm" onClick={() => setZoneForm(row)} />
                  ),
                },
              ]}
            />
          )}
        </Card>
      </div>

      <Card
        title="Horário de funcionamento"
        icone="relogio"
        descricao="Registro informativo: nesta versão o sistema não bloqueia pedidos fora do horário."
        actions={<Badge tone="blue">informativo</Badge>}
      >
        {hours.isLoading ? (
          <LoadingBlock />
        ) : (
          <div className="space-y-2">
            {(hours.data ?? []).map((hour) => (
              <div
                key={hour.id}
                className={`flex flex-wrap items-center gap-3 rounded-control border px-3 py-2 transition ${
                  hour.is_open ? 'border-ink-200 bg-white' : 'border-ink-100 bg-ink-50/70'
                }`}
              >
                <span className={`w-32 text-sm font-medium ${hour.is_open ? 'text-ink-800' : 'text-ink-500'}`}>
                  {WEEKDAYS[hour.weekday]}
                </span>
                <Checkbox
                  label="Aberto"
                  checked={hour.is_open}
                  onChange={async (checked) => {
                    try {
                      await api.saveBusinessHour(hour.id, {
                        is_open: checked,
                        opens_at: checked ? (hour.opens_at ?? '18:00') : null,
                        closes_at: checked ? (hour.closes_at ?? '23:30') : null,
                      })
                      queryClient.invalidateQueries({ queryKey: ['business-hours'] })
                    } catch (error) {
                      toast.error(translateError(error))
                    }
                  }}
                />
                <Input
                  type="time"
                  className="w-32"
                  value={hour.opens_at ?? '18:00'}
                  disabled={!hour.is_open}
                  onChange={async (event) => {
                    try {
                      await api.saveBusinessHour(hour.id, { opens_at: event.target.value })
                      queryClient.invalidateQueries({ queryKey: ['business-hours'] })
                    } catch (error) {
                      toast.error(translateError(error))
                    }
                  }}
                />
                <span className="text-ink-400">até</span>
                <Input
                  type="time"
                  className="w-32"
                  value={hour.closes_at ?? '23:30'}
                  disabled={!hour.is_open}
                  onChange={async (event) => {
                    try {
                      await api.saveBusinessHour(hour.id, { closes_at: event.target.value })
                      queryClient.invalidateQueries({ queryKey: ['business-hours'] })
                    } catch (error) {
                      toast.error(translateError(error))
                    }
                  }}
                />
              </div>
            ))}
            <p className="text-[11px] text-ink-500">
              Os horários são registro informativo: nesta versão o sistema <strong>não</strong> bloqueia pedidos fora do
              horário, nem integra com apps de entrega.
            </p>
          </div>
        )}
      </Card>

      {/* Modal de forma de pagamento */}
      <Modal
        open={Boolean(methodForm)}
        title={methodForm?.id ? 'Editar forma de pagamento' : 'Nova forma de pagamento'}
        onClose={() => setMethodForm(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setMethodForm(null)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (!methodForm) return
                if (!/^[a-z][a-z0-9_]{1,29}$/.test(methodForm.id)) {
                  toast.error('O código deve ter 2 a 30 caracteres: letras minúsculas, números e _ (ex.: pix, credit_card).')
                  return
                }
                try {
                  await api.savePaymentMethod({
                    id: methodForm.id,
                    label: methodForm.label.trim() || methodForm.id,
                    kind: methodForm.kind,
                    affects_cash_drawer: methodForm.affects_cash_drawer,
                    requires_change: methodForm.requires_change,
                    allows_prepaid: methodForm.allows_prepaid,
                    is_active: methodForm.is_active,
                    is_default: methodForm.is_default,
                    sort_order: methodForm.sort_order,
                  })
                  toast.success('Forma de pagamento salva.')
                  setMethodForm(null)
                  queryClient.invalidateQueries({ queryKey: ['payment-methods'] })
                } catch (error) {
                  toast.error(translateError(error))
                }
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        {methodForm && (
          <div className="space-y-3">
            <Field label="Código *" hint="Identificador estável usado no banco (ex.: pix, credit_card).">
              <Input
                value={methodForm.id}
                disabled={Boolean(methods.data?.some((method) => method.id === methodForm.id))}
                onChange={(event) => setMethodForm({ ...methodForm, id: event.target.value.toLowerCase() })}
              />
            </Field>
            <Field label="Rótulo exibido *">
              <Input value={methodForm.label} onChange={(event) => setMethodForm({ ...methodForm, label: event.target.value })} />
            </Field>
            <Field label="Tipo">
              <Select
                value={methodForm.kind}
                onChange={(event) => setMethodForm({ ...methodForm, kind: event.target.value as PaymentMethod['kind'] })}
              >
                <option value="cash">Dinheiro</option>
                <option value="pix">Pix</option>
                <option value="debit_card">Cartão de débito</option>
                <option value="credit_card">Cartão de crédito</option>
                <option value="other">Outro</option>
              </Select>
            </Field>
            <div className="space-y-2">
              <Checkbox
                label="Afeta a gaveta (dinheiro físico)"
                checked={methodForm.affects_cash_drawer}
                onChange={(checked) => setMethodForm({ ...methodForm, affects_cash_drawer: checked })}
              />
              <Checkbox
                label="Exige valor recebido e calcula troco"
                checked={methodForm.requires_change}
                onChange={(checked) => setMethodForm({ ...methodForm, requires_change: checked })}
              />
              <Checkbox
                label="Permite pagamento antecipado"
                checked={methodForm.allows_prepaid}
                onChange={(checked) => setMethodForm({ ...methodForm, allows_prepaid: checked })}
              />
              <Checkbox
                label="Ativa"
                checked={methodForm.is_active}
                onChange={(checked) => setMethodForm({ ...methodForm, is_active: checked })}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Modal de bairro */}
      <Modal
        open={Boolean(zoneForm)}
        title={zoneForm?.id ? 'Editar bairro' : 'Novo bairro'}
        onClose={() => setZoneForm(null)}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setZoneForm(null)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (!zoneForm?.neighborhood) {
                  toast.error('Informe o nome do bairro.')
                  return
                }
                try {
                  await api.upsertDeliveryZone({
                    id: zoneForm.id,
                    neighborhood: zoneForm.neighborhood.trim(),
                    fee_cents: zoneForm.fee_cents ?? 0,
                    is_active: zoneForm.is_active ?? true,
                  })
                  toast.success('Bairro salvo.')
                  setZoneForm(null)
                  queryClient.invalidateQueries({ queryKey: ['delivery-zones'] })
                } catch (error) {
                  toast.error(translateError(error))
                }
              }}
            >
              Salvar
            </Button>
          </>
        }
      >
        {zoneForm && (
          <div className="space-y-3">
            <Field label="Bairro *">
              <Input
                value={zoneForm.neighborhood ?? ''}
                onChange={(event) => setZoneForm({ ...zoneForm, neighborhood: event.target.value })}
              />
            </Field>
            <Field label="Taxa de entrega (R$)">
              <Input
                inputMode="decimal"
                value={((zoneForm.fee_cents ?? 0) / 100).toFixed(2).replace('.', ',')}
                onChange={(event) => setZoneForm({ ...zoneForm, fee_cents: parseMoneyToCents(event.target.value) })}
              />
            </Field>
            <Checkbox
              label="Bairro ativo"
              checked={zoneForm.is_active ?? true}
              onChange={(checked) => setZoneForm({ ...zoneForm, is_active: checked })}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}

/**
 * Campo de dinheiro com digitação confortável.
 *
 * O valor no banco é sempre em centavos, mas o operador digita texto livre
 * ("12", "12,5", "R$ 12,50"). O campo só normaliza ao sair do foco — assim o
 * cursor não pula enquanto se digita.
 */
function CampoDinheiro({
  label,
  hint,
  cents,
  onChange,
  className,
}: {
  label: string
  hint?: string
  cents: number
  onChange: (cents: number) => void
  className?: string
}) {
  const formatar = (valor: number) => (valor / 100).toFixed(2).replace('.', ',')
  const [texto, setTexto] = useState(() => formatar(cents))
  const digitando = useRef(false)

  useEffect(() => {
    if (!digitando.current) setTexto(formatar(cents))
  }, [cents])

  return (
    <Field label={label} hint={hint} className={className}>
      <Input
        inputMode="decimal"
        value={texto}
        onFocus={() => {
          digitando.current = true
        }}
        onChange={(event) => {
          setTexto(event.target.value)
          onChange(parseMoneyToCents(event.target.value))
        }}
        onBlur={() => {
          digitando.current = false
          setTexto(formatar(cents))
        }}
      />
    </Field>
  )
}
