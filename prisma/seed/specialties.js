const { idFromNumber } = require("./ids");

const specialties = [
  { id: idFromNumber(1), name: "Tim mạch", description: "Khám và điều trị bệnh tim mạch", icon: "heart" },
  { id: idFromNumber(2), name: "Da liễu", description: "Chăm sóc và điều trị bệnh lý da", icon: "sparkles" },
  { id: idFromNumber(3), name: "Thần kinh", description: "Bệnh lý thần kinh trung ương và ngoại biên", icon: "brain" },
  { id: idFromNumber(4), name: "Nhi khoa", description: "Khám và điều trị cho trẻ em", icon: "baby" },
  { id: idFromNumber(5), name: "Tiêu hóa", description: "Bệnh lý tiêu hóa và gan mật", icon: "stethoscope" },
  { id: idFromNumber(6), name: "Tai Mũi Họng", description: "Khám bệnh lý tai mũi họng", icon: "ear" },
  { id: idFromNumber(7), name: "Nội tiết", description: "Rối loạn nội tiết và chuyển hóa", icon: "flask" },
  { id: idFromNumber(8), name: "Cơ xương khớp", description: "Bệnh lý xương khớp và cột sống", icon: "bone" },
  { id: idFromNumber(9), name: "Sản phụ khoa", description: "Sức khỏe phụ nữ và thai kỳ", icon: "shield" },
  { id: idFromNumber(10), name: "Mắt", description: "Khám và điều trị nhãn khoa", icon: "eye" },
  { id: idFromNumber(11), name: "Hô hấp", description: "Bệnh lý phổi và đường hô hấp", icon: "wind" },
  { id: idFromNumber(12), name: "Thận - Tiết niệu", description: "Bệnh lý thận và tiết niệu", icon: "droplets" },
];

module.exports = { specialties };
