const { idFromNumber } = require("./ids");

const users = [
  {
    id: idFromNumber(9001),
    email: "admin@example.com",
    password: "ChangeMe123!",
    name: "Quản trị viên",
    phone: "0900000000",
    role: "ADMIN",
  },
];

module.exports = { users };
