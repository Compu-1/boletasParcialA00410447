// =========================================================
// SECCIÓN 1: Imports y variables de conexión
// =========================================================
const Ice = require('ice').Ice;
const stubModule = require('./ice-stubs/BookingService.js'); // necesario para que Webpack no elimine esta línea (carga el stub en window.BookingApp)

let communicator;
let service;

// Identificador único de este cliente/navegador (para lockSeat/releaseSeat/confirmBooking)
// Se guarda en localStorage para que sobreviva recargas de página.
function getClientId() {
    let clientId = localStorage.getItem('clientId');
    if (!clientId) {
        clientId = 'WEB-' + Math.random().toString(36).substring(2, 10).toUpperCase();
        localStorage.setItem('clientId', clientId);
    }
    return clientId;
}
const CLIENT_ID = getClientId();

// =========================================================
// SECCIÓN 2: Estado de la aplicación
// =========================================================
const seatsData = {};       // { "A-1": { seat: Seat, element: <div> }, ... }
const timers = {};          // { "A-1": intervalId } -- para poder cancelar el cronómetro de cada silla
const selectedSeats = new Set(); // ids de sillas que YO bloqueé en esta sesión, listas para confirmar compra

// =========================================================
// SECCIÓN 3: Conexión Ice
// =========================================================
async function connect() {
    communicator = Ice.initialize();
    const base = communicator.stringToProxy("BookingService:ws -h 127.0.0.1 -p 10002");
    const BookingApp = window.BookingApp;
    service = await BookingApp.BookingServicePrx.checkedCast(base);
}

// =========================================================
// SECCIÓN 4: Traer las sillas del servidor
// =========================================================
async function loadSeats() {
    const seats = await service.getAllSeats();
    for (const s of seats) {
        seatsData[s.id] = { seat: s, element: null };
    }
}

// =========================================================
// SECCIÓN 5: Pintar las sillas en el DOM
// =========================================================
const BookingApp = window.BookingApp; // alias corto, ya está cargado para cuando esto se ejecute

function stateClass(state) {
    if (state === BookingApp.SeatState.AVAILABLE) return 'seat--available';
    if (state === BookingApp.SeatState.LOCKED) return 'seat--locked';
    if (state === BookingApp.SeatState.BOOKED) return 'seat--booked';
    return '';
}

function zoneClass(zone) {
    if (zone === BookingApp.SeatZone.ZONEVIP) return 'seat--vip';
    if (zone === BookingApp.SeatZone.ZONEPLATEA) return 'seat--platea';
    if (zone === BookingApp.SeatZone.ZONEGENERAL) return 'seat--general';
    return '';
}

// Actualiza SOLO el aspecto visual de una silla (sin recrear el div), a partir de seatsData
function updateSeatVisual(seatId) {
    const entry = seatsData[seatId];
    if (!entry || !entry.element) return;

    const seat = entry.seat;
    const div = entry.element;

    div.className = 'seat ' + zoneClass(seat.zone) + ' ' + stateClass(seat.state);

    if (seat.state === BookingApp.SeatState.AVAILABLE) {
        div.textContent = seat.id;
    } else if (seat.state === BookingApp.SeatState.LOCKED) {
        // el texto con el cronómetro se actualiza aparte, en startCountdown
        div.textContent = seat.id + ' (bloqueada)';
    } else if (seat.state === BookingApp.SeatState.BOOKED) {
        div.textContent = seat.id + ' (vendida)';
    }
}

function renderSeats() {
    const container = document.getElementById('app');
    container.innerHTML = ''; // limpia por si se vuelve a llamar

    for (const seatId in seatsData) {
        const entry = seatsData[seatId];
        const div = document.createElement('div');
        entry.element = div;

        div.addEventListener('click', () => onSeatClick(seatId));

        container.appendChild(div);
        updateSeatVisual(seatId); // pinta el texto/clase inicial
    }
}

// =========================================================
// SECCIÓN 6: Click en una silla -> lockSeat + cronómetro
// =========================================================
async function onSeatClick(seatId) {
    const entry = seatsData[seatId];
    if (!entry) return;

    // Si ya está BOOKED o LOCKED por otro, no hacemos nada
    if (entry.seat.state !== BookingApp.SeatState.AVAILABLE) {
        console.log(`Silla ${seatId} no está disponible (estado actual: ${entry.seat.state})`);
        return;
    }

    try {
        const lockResult = await service.lockSeat(seatId, CLIENT_ID);

        if (lockResult.success) {
            // Actualizamos nuestro estado local con lo que el servidor confirmó
            entry.seat.state = BookingApp.SeatState.LOCKED;
            entry.seat.lockedByClientId = CLIENT_ID;

            selectedSeats.add(seatId);
            updateSeatVisual(seatId);
            startCountdown(seatId, lockResult.expiresAt.toNumber());
            updateCheckoutButton();
        } else {
            alert('No se pudo bloquear la silla: ' + lockResult.message);
        }
    } catch (err) {
        // Excepciones declaradas en el .ice: SeatNotAvailableException, SeatNotFoundException
        alert('Error al bloquear la silla: ' + (err.reason || err.message || err));
        console.error(err);
    }
}

// Cronómetro visual de 90s. "expiresAt" viene del servidor en milisegundos (System.currentTimeMillis()).
function startCountdown(seatId, expiresAt) {
    // Si ya había un cronómetro corriendo para esta silla, lo cancelamos primero
    if (timers[seatId]) {
        clearInterval(timers[seatId]);
    }

    const entry = seatsData[seatId];

    timers[seatId] = setInterval(() => {
        const now = Date.now();
        const msRestantes = expiresAt - now;

        if (msRestantes <= 0) {
            clearInterval(timers[seatId]);
            delete timers[seatId];

            // El lock expiró: lo reflejamos localmente como AVAILABLE de nuevo
            entry.seat.state = BookingApp.SeatState.AVAILABLE;
            entry.seat.lockedByClientId = '';
            selectedSeats.delete(seatId);
            updateSeatVisual(seatId);
            updateCheckoutButton();
            return;
        }

        const segundosRestantes = Math.ceil(msRestantes / 1000);
        if (entry.element) {
            entry.element.textContent = `${seatId} (${segundosRestantes}s)`;
        }
    }, 1000);
}

// =========================================================
// SECCIÓN 7: Botón / modal de checkout
// =========================================================
function updateCheckoutButton() {
    const btn = document.getElementById('checkout-btn');
    if (!btn) return;
    btn.disabled = selectedSeats.size === 0;
    btn.textContent = `Confirmar compra (${selectedSeats.size} silla(s))`;
}

function openCheckoutModal() {
    if (selectedSeats.size === 0) return;
    document.getElementById('checkout-modal').style.display = 'flex';
}

function closeCheckoutModal() {
    document.getElementById('checkout-modal').style.display = 'none';
}

async function confirmPurchase() {
    const name = document.getElementById('customer-name').value.trim();
    const email = document.getElementById('customer-email').value.trim();

    if (!name || !email) {
        alert('Nombre y correo son obligatorios.');
        return;
    }

    const seatIdsArray = Array.from(selectedSeats);

    try {
        const result = await service.confirmBooking(seatIdsArray, CLIENT_ID, name, email);

        if (result.success) {
            alert(`¡Compra confirmada! Código: ${result.bookingCode}\nTotal: $${result.totalAmount.toLocaleString('es-CO')} COP`);

            // Limpiamos cronómetros y marcamos las sillas como BOOKED localmente
            for (const seatId of seatIdsArray) {
                if (timers[seatId]) {
                    clearInterval(timers[seatId]);
                    delete timers[seatId];
                }
                const entry = seatsData[seatId];
                entry.seat.state = BookingApp.SeatState.BOOKED;
                updateSeatVisual(seatId);
            }
            selectedSeats.clear();
            updateCheckoutButton();
            closeCheckoutModal();
        } else {
            alert('No se pudo confirmar la compra: ' + result.message);
        }
    } catch (err) {
        alert('Error al confirmar la compra: ' + (err.reason || err.message || err));
        console.error(err);
    }
}

// =========================================================
// SECCIÓN 8: Arranque de la aplicación
// =========================================================
async function main() {
    await connect();
    await loadSeats();
    renderSeats();
    updateCheckoutButton();

    document.getElementById('checkout-btn').addEventListener('click', openCheckoutModal);
    document.getElementById('checkout-cancel-btn').addEventListener('click', closeCheckoutModal);
    document.getElementById('checkout-confirm-btn').addEventListener('click', confirmPurchase);
}

main();