import { io, type Socket } from 'socket.io-client';
import { useEffect, useRef } from 'react';

let socket: Socket | null = null;
let identity = '';
const subscribers = new Set<{ event: string; handler: () => void }>();

function connect(key: string, auth: Record<string, string>): Socket {
  if (socket && identity === key) return socket;
  disconnectSocket();
  identity = key;
  socket = io((import.meta.env.VITE_SOCKET_URL as string | undefined) ?? '/', {
    path: '/socket.io', transports: ['websocket', 'polling'], auth, withCredentials: true,
  });
  for (const { event, handler } of subscribers) socket.on(event, handler);
  return socket;
}
export function connectStaffSocket(accessToken: string): Socket {
  return connect(`staff:${accessToken}`, { accessToken, role: 'STAFF' });
}
export function connectGuestSocket(participantId: string): Socket {
  // The browser sends the HttpOnly session cookie; never expose it to JavaScript.
  return connect(`guest:${participantId}`, { role: 'GUEST' });
}
export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
  identity = '';
}
export function getSocket(): Socket | null { return socket; }

// Also attach listeners when a socket is created after the child effects.
export function useSocketEvent(event: string, callback: () => void): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  useEffect(() => {
    const entry = { event, handler: () => callbackRef.current() };
    subscribers.add(entry);
    socket?.on(event, entry.handler);
    return () => { subscribers.delete(entry); socket?.off(event, entry.handler); };
  }, [event]);
}
