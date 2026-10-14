import { useEffect, useState } from 'react'
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
  Input,
  LoadingBlock,
  Modal,
  Select,
  Textarea,
  useToast,
} from '../components/ui'
import { formatMoney, parseMoneyToCents } from '../lib/format'
import { translateError } from '../lib/errors'
import type { BusinessSettings, DeliveryFeeZone, PaymentMethod } from '../lib/types'

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

  if (settings.isLoading || !draft) return <LoadingBlock label="Carregando configurações…" />

  return (
    <div className="space-y-4">
      <Card
        title="Dados da pizzaria"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => settings.data && setDraft(settings.data)} disabled={busy}>
              Descartar alterações
            </Button>
            <Button size="sm" onClick={saveSettings} loading={busy}>
              Salvar configurações
            </Button>
          </div>
        }
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
          <div className="space-y-2 rounded-md border border-slate-200 p-3">
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
          <Field label="Taxa de entrega padrão (R$)">
            <Input
              inputMode="decimal"
              value={(draft.default_delivery_fee_cents / 100).toFixed(2).replace('.', ',')}
              onChange={(event) => setDraft({ ...draft, default_delivery_fee_cents: parseMoneyToCents(event.target.value) })}
            />
          </Field>
          <Field label="Pedido mínimo para delivery (R$)">
            <Input
              inputMode="decimal"
              value={(draft.min_delivery_order_cents / 100).toFixed(2).replace('.', ',')}
              onChange={(event) => setDraft({ ...draft, min_delivery_order_cents: parseMoneyToCents(event.target.value) })}
            />
          </Field>
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
          <Field label="Desconto máximo do caixa (% )" hint="Acima disso o sistema exige administrador.">
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.max_discount_pct_without_auth}
              onChange={(event) => setDraft({ ...draft, max_discount_pct_without_auth: Number(event.target.value) })}
            />
          </Field>
          <Field label="Teto absoluto de desconto (%)" hint="Limite máximo aceito pelo sistema.">
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.max_discount_pct_hard}
              onChange={(event) => setDraft({ ...draft, max_discount_pct_hard: Number(event.target.value) })}
            />
          </Field>
          <Field label="Tolerância de divergência de caixa (R$)" hint="Diferenças acima disso exigem justificativa.">
            <Input
              inputMode="decimal"
              value={(draft.cash_variance_tolerance_cents / 100).toFixed(2).replace('.', ',')}
              onChange={(event) => setDraft({ ...draft, cash_variance_tolerance_cents: parseMoneyToCents(event.target.value) })}
            />
          </Field>
        </div>

        <p className="mt-3 text-[11px] text-slate-500">
          Alterações de configuração são auditadas com o valor anterior e o novo. Perfil atual:{' '}
          <strong>{profile?.full_name}</strong> {profile && <Badge tone="brand">{profile.role}</Badge>}
        </p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Formas de pagamento"
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
            rows={methods.data ?? []}
            rowKey={(row) => row.id}
            emptyMessage="Nenhuma forma cadastrada."
            columns={[
              { key: 'label', header: 'Forma', render: (row) => row.label },
              { key: 'kind', header: 'Tipo', render: (row) => row.kind },
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
          <p className="mt-2 text-[11px] text-slate-500">
            Pix, cartão e dinheiro são <strong>registrados manualmente</strong> pelo operador. Não há integração com
            adquirentes nem conciliação automática nesta versão.
          </p>
        </Card>

        <Card
          title="Bairros e taxas de entrega"
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
                    <Button size="sm" variant="ghost" onClick={() => setZoneForm(row)}>
                      Editar
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </Card>
      </div>

      <Card title="Horário de funcionamento" actions={<Badge tone="blue">informativo nesta versão</Badge>}>
        {hours.isLoading ? (
          <LoadingBlock />
        ) : (
          <div className="space-y-2">
            {(hours.data ?? []).map((hour) => (
              <div key={hour.id} className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200 px-3 py-2">
                <span className="w-32 text-sm text-slate-700">{WEEKDAYS[hour.weekday]}</span>
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
                <span className="text-slate-400">até</span>
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
            <p className="text-[11px] text-slate-500">
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
