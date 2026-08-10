const { idFromNumber } = require("./ids");

const hospitals = [
  {
    id: idFromNumber(101),
    name: "Bệnh viện Đa khoa Tâm An",
    address: "12 Nguyễn Du, Quận 1, TP. Hồ Chí Minh",
    phone: "028-3822-0001",
  },
  {
    id: idFromNumber(102),
    name: "Bệnh viện Quốc tế Hòa Bình",
    address: "89 Hai Bà Trưng, Hoàn Kiếm, Hà Nội",
    phone: "024-3936-0002",
  },
  {
    id: idFromNumber(103),
    name: "Bệnh viện Trung tâm Đà Nẵng",
    address: "210 Trần Phú, Hải Châu, Đà Nẵng",
    phone: "0236-355-0003",
  },
  {
    id: idFromNumber(104),
    name: "Phòng khám Chuyên sâu Phúc Lộc",
    address: "33 Võ Văn Tần, Quận 3, TP. Hồ Chí Minh",
    phone: "028-3930-0004",
  },
];

module.exports = { hospitals };
