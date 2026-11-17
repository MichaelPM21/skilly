/**
 * Flujo del módulo. Validación pura de contacto, reutilizada por actualización de perfil y
 * pruebas. No lee ni escribe la base: el llamador persiste únicamente cuando todas las
 * validaciones terminan.
 */

// Optional contact fields are validated before any profile change is persisted.
/**
 * Valida los campos opcionales de contacto antes de persistir el perfil. Normaliza teléfono,
 * calcula el dígito verificador del RUT chileno y recorta la dirección; devuelve phone, rut y
 * address o lanza Error.
 */
function contactProfile(body) {
  /**
   * Lee un campo opcional del cuerpo, exige texto dentro del máximo y elimina espacios exteriores.
   * Usa cadena vacía cuando el dato no fue proporcionado.
   */
  function field(name, max) {
    const value = body[name] ?? '';
    if (typeof value !== 'string' || value.length > max) throw new Error('Revisa el campo ' + name + '.');
    return value.trim();
  }
  let phone = field('phone', 40);
  let rut = field('rut', 40);
  const address = field('address', 300);
  if (phone) {
    if (!/^\+?[\d ()-]+$/.test(phone)) throw new Error('Ingresa un teléfono válido, por ejemplo +56 9 1234 5678.');
    phone = phone.replace(/[ ()-]/g, '');
    if (!/^\+?\d{8,15}$/.test(phone)) throw new Error('El teléfono debe contener entre 8 y 15 dígitos.');
  }
  if (rut) {
    if (!/^[\d.kK-]+$/.test(rut)) throw new Error('Revisa el RUT y su dígito verificador.');
    const compact = rut.replace(/[.-]/g, '').toUpperCase();
    if (!/^\d{7,8}[\dK]$/.test(compact) || /^0+$/.test(compact.slice(0, -1))) throw new Error('Revisa el RUT y su dígito verificador.');
    const digits = compact.slice(0, -1);
    let sum = 0;
    [...digits].reverse().forEach((digit, i) => {
      // Aplica los factores cíclicos de 2 a 7 a los dígitos del RUT invertido para calcular su verificador.
       sum += Number(digit) * (2 + i % 6); });
    const remainder = 11 - sum % 11;
    const check = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
    if (compact.at(-1) !== check) throw new Error('El dígito verificador del RUT no coincide.');
    rut = digits + '-' + check;
  }
  return { phone, rut, address };
}
module.exports = { contactProfile };
