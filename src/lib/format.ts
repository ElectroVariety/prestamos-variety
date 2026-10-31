export function applicationReference(id: string) {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase()
}

export function formatDateTime(value: string | Date) {
  return new Intl.DateTimeFormat('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value))
}
