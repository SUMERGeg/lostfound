import { randomUUID } from 'node:crypto'

export async function enqueueOutbox(connection, { eventType, aggregateType, aggregateId, payload }) {
  const id = randomUUID()
  await connection.query(
    `INSERT INTO outbox_events
       (id, event_type, aggregate_type, aggregate_id, payload, available_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, eventType, aggregateType ?? null, aggregateId ?? null, JSON.stringify(payload)]
  )
  return id
}
