const { idFromNumber } = require("./ids");
const { hospitals } = require("./hospitals");

const locations = [
  {
    id: idFromNumber(201),
    hospital_id: hospitals[0].id,
    address: "12 Nguyễn Du, Quận 1",
    city: "TP. Hồ Chí Minh",
  },
  {
    id: idFromNumber(202),
    hospital_id: hospitals[0].id,
    address: "45 Lê Văn Sỹ, Quận 3",
    city: "TP. Hồ Chí Minh",
  },
  {
    id: idFromNumber(203),
    hospital_id: hospitals[1].id,
    address: "89 Hai Bà Trưng, Hoàn Kiếm",
    city: "Hà Nội",
  },
  {
    id: idFromNumber(204),
    hospital_id: hospitals[1].id,
    address: "120 Trần Duy Hưng, Cầu Giấy",
    city: "Hà Nội",
  },
  {
    id: idFromNumber(205),
    hospital_id: hospitals[2].id,
    address: "210 Trần Phú, Hải Châu",
    city: "Đà Nẵng",
  },
  {
    id: idFromNumber(206),
    hospital_id: hospitals[2].id,
    address: "75 Nguyễn Văn Linh, Thanh Khê",
    city: "Đà Nẵng",
  },
  {
    id: idFromNumber(207),
    hospital_id: hospitals[3].id,
    address: "33 Võ Văn Tần, Quận 3",
    city: "TP. Hồ Chí Minh",
  },
  {
    id: idFromNumber(208),
    hospital_id: hospitals[3].id,
    address: "108 Phan Xích Long, Phú Nhuận",
    city: "TP. Hồ Chí Minh",
  },
];

module.exports = { locations };
