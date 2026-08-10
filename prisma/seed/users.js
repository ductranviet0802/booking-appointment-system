const { idFromNumber } = require("./ids");

const users = [
  {
    id: idFromNumber(9001),
    email: "ductv7",
    password: "Admin1234",
    name: "Quản trị viên",
    phone: "0900000000",
    role: "ADMIN",
  },
];

module.exports = { users };
