function idFromNumber(num) {
  const hex = num.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

module.exports = {
  idFromNumber,
};
