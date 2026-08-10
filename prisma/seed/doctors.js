const { idFromNumber } = require("./ids");
const { specialties } = require("./specialties");
const { hospitals } = require("./hospitals");

const doctorNames = [
  "BS. Nguyễn Văn Minh",
  "ThS. Trần Thị Lan",
  "BS. Lê Quốc Bảo",
  "BS. Phạm Thu Hằng",
  "ThS. Võ Thanh Tùng",
  "BS. Đặng Hải Yến",
  "BS. Hoàng Anh Tuấn",
  "BS. Bùi Ngọc Mai",
  "ThS. Đỗ Minh Châu",
  "BS. Vũ Quang Huy",
  "BS. Nguyễn Thu Hà",
  "BS. Trịnh Gia Phúc",
  "BS. Lương Khánh Linh",
  "ThS. Đinh Minh Đức",
  "BS. Phan Quỳnh Anh",
  "BS. Tạ Thanh Sơn",
  "BS. Chu Hải Nam",
  "ThS. Mai Thu Uyên",
  "BS. Lý Công Thành",
  "BS. Trần Ngọc Hân",
  "BS. Đoàn Đức Trung",
  "BS. Đàm Anh Thư",
  "BS. Nguyễn Hoài Nam",
  "ThS. Phùng Bảo Trân",
  "BS. Lê Minh Khôi",
];

const doctors = doctorNames.map((name, index) => {
  const specialty = specialties[index % specialties.length];
  const hospital = hospitals[index % hospitals.length];
  const experience = 2 + (index % 29);
  const rating = Number((3.5 + ((index % 16) * 0.1)).toFixed(1));
  const fee = 100000 + (index % 9) * 50000;

  return {
    id: idFromNumber(300 + index),
    specialty_id: specialty.id,
    hospital_id: hospital.id,
    name,
    experience,
    rating,
    fee,
    description: `${name} chuyên ${specialty.name}, nhiều năm kinh nghiệm trong khám và điều trị lâm sàng.`,
    avatar: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(name)}`,
  };
});

module.exports = { doctors };
