# Foods MQTT — Sistema Comercial para Foods

Sistema didático de pedidos com interface web, perfis de Gerência/Cozinha/Caixa, banco SQLite e comunicação MQTT com ESP32 no Wokwi.

## Requisitos

- Windows 10/11
- Node.js LTS instalado
- Navegador moderno
- Conta/acesso ao Wokwi para simulação ESP32
- Internet para conectar ao broker MQTT público

## 1. Iniciar o backend e a Web

1. Extraia o ZIP.
2. Abra o PowerShell na pasta `foods-mqtt\server`.
3. Copie `.env.example` para `.env` (opcional para iniciar localmente).
4. Execute:

   ```powershell
   npm install
   npm start
   ```

5. Abra `http://localhost:3000`.

O banco `foods.sqlite` será criado automaticamente na pasta `server`. Não apague esse arquivo se quiser preservar os pedidos.

## 2. Usuários de demonstração

| Perfil | Usuário | Senha |
|---|---|---|
| Gerência | `gerencia` | `Gerencia@123` |
| Cozinha | `cozinha` | `Cozinha@123` |
| Caixa | `caixa` | `Caixa@123` |

Esses usuários são criados na primeira inicialização do banco vazio.

## 3. Criar pedido de teste pela Web

Entre como Gerência. No formulário "Novo pedido (teste pelo navegador)", use por exemplo:
- Mesa: `5`
- Cliente: `Cliente Teste`
- Item: `X-Burger`
- Preço: `25`
- Quantidade: `2`

O backend calcula o total (R$ 50,00), salva no SQLite e publica para os tópicos de impressão se estiver conectado ao MQTT.

## 4. Wokwi

1. Abra https://wokwi.com/ e crie um projeto ESP32.
2. Copie `wokwi/sketch.ino` para o editor do Wokwi.
3. Copie `wokwi/diagram.json` para o arquivo de diagrama.
4. Adicione o arquivo `libraries.txt` com o conteúdo de `wokwi/libraries.txt` (ou declare as bibliotecas pelo gerenciador do projeto, conforme a interface atual).
5. Clique Run e abra o Serial Monitor.

O ESP32 assina:
- `escola/seu-grupo/foods/impressao/cozinha`
- `escola/seu-grupo/foods/impressao/caixa`

O backend publica nos dois tópicos ao criar um pedido. A impressão no Wokwi é simulada pelo Serial Monitor.

## 5. IoT MQTT Panel

Configure o broker `broker.hivemq.com`, porta `1883`, MQTT sem TLS para teste. Publique JSON no tópico:

`escola/seu-grupo/foods/pedidos/novo`

Payload de exemplo:

```json
{
  "mesa": 5,
  "cliente": "Cliente Teste",
  "itens": [
    {
      "nome": "X-Burger",
      "precoUnitario": 25,
      "quantidade": 2
    }
  ]
}
```

O backend calcula o total e publica a ordem normalizada para cozinha e caixa. Se publicar manualmente, não use dados pessoais reais.

## 6. Perfis

- Gerência: vê pedidos e filtros; pode criar pedido de teste e atualizar status.
- Cozinha: vê pedidos em `PREPARANDO` e pode marcá-los `PRONTO`.
- Caixa: vê pedidos `PRONTO`/`PAGO`, pode criar pedido de teste e marcar `PAGO`.

## 7. Endpoints úteis

- `GET /api/me`
- `POST /api/login`
- `POST /api/logout`
- `GET /api/orders`
- `POST /api/orders`
- `PATCH /api/orders/:id/status`
- `GET /api/events` (Server-Sent Events para atualização da Web)

## 8. Impressora física

A simulação Wokwi não controla uma impressora real. Para imprimir em papel, identifique o modelo exato da impressora e se ela usa Bluetooth Classic/SPP, USB, serial TTL ou Ethernet. A interface física define a adaptação de hardware e código. Não conecte a impressora diretamente ao ESP32 sem confirmar níveis elétricos e protocolo.

## 9. Segurança e limitações da demonstração

- O broker MQTT público é compartilhado; o tópico acima é apenas um exemplo. Escolha um identificador exclusivo para o grupo.
- O broker público sem autenticação/TLS não deve ser usado para dados reais.
- Troque `SESSION_SECRET` e restrinja acesso antes de publicar na internet.
- Este projeto é uma base educacional, não um sistema de produção.
