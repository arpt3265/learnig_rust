// 分三级提示：h1 只指方向，h2 点出该用的 API，h3 给骨架。
// 原则：h1 绝不出现类型名/方法名，逼你先自己想；h3 也只给结构，不把整题抄完。
export const HINTS = {
  '03_ticket_v1/00_intro': {
    h1: '这题是热身。函数返回的字符串必须和测试里期望的一模一样，一个字符都不能差。',
    h2: '返回类型是 `&\'static str`，直接写字符串字面量就行，不用 `String::from`。',
    h3: '`fn intro() -> &\'static str { "…" }` —— 引号里原样抄测试里那句。',
  },
  '03_ticket_v1/01_struct': {
    h1: '两件事：定义结构体，再给它加一个方法。方法只读字段，别把 `self` 吃掉。',
    h2: '字段要求是「无符号整数」，`u64` 这种就行；方法签名写 `fn is_available(&self) -> bool`，函数体就是判断数量大于 0。',
    h3: '`pub struct Order { pub price: u64, pub quantity: u64 }` + `impl Order { pub fn is_available(&self) -> bool { self.quantity > 0 } }`',
  },
  '03_ticket_v1/02_validation': {
    h1: '四个条件各写一个 `if`，任意一条不满足就 `panic!`。别把两个条件挤进同一个 `if`。',
    h2: '判空用 `is_empty()`；判长度用 `len() > 上限`，`len()` 算的正好是字节数；状态白名单要用 `!=` 串起来，连词是 `&&` 不是 `||`。',
    h3: '`if title.is_empty() { panic!("…") }`；`if status != "To-Do" && status != "In Progress" && status != "Done" { panic!("…") }`',
  },
  '03_ticket_v1/03_modules': {
    h1: '这题不考逻辑，考路径：`Ticket` 定义在模块外面，`helpers` 模块里看不见它。',
    h2: '在 `helpers` 模块里 `use crate::Ticket;`，或者把类型和构造调用都写成 `crate::Ticket`。',
    h3: '`mod helpers { use crate::Ticket; fn create_todo_ticket(…) -> Ticket { … } }`',
  },
  '03_ticket_v1/04_visibility': {
    h1: '这题是故意的：结构体和 `new` 要让测试看得见，但**字段必须保持私有** —— 否则那两个「应该编译不过」的函数就会编过。',
    h2: '只给 `struct Ticket` 和 `fn new` 加 `pub`，字段一个都别加。然后按注释把测试里那两行故意报错的代码注释掉。',
    h3: '`pub struct Ticket { title: String, … }` + `impl Ticket { pub fn new(…) -> Ticket }`，字段保持 `title: String` 原样。',
  },
  '03_ticket_v1/05_encapsulation': {
    h1: '字段不让外人直接碰，只提供方法读。',
    h2: '三个方法都只读，用 `&self`；返回 `&str` 借用字段，别返回 `String`（那会逼你 `clone`）。',
    h3: '`pub fn title(&self) -> &str { &self.title }`',
  },
  '03_ticket_v1/06_ownership': {
    h1: '现在这些方法一调用就把 `Ticket` 消耗掉了，所以用第二次就报 E0382。改成「借用」。',
    h2: '参数 `self` → `&self`；返回 `String` → `&str`，否则你还得 `clone` 一份。',
    h3: '`pub fn title(&self) -> &str { &self.title }`',
  },
  '03_ticket_v1/07_setters': {
    h1: 'setter 要改字段所以得 `&mut self`；但改完也得合法，所以校验逻辑要和 `new` 共用一份，别复制粘贴。',
    h2: '把每个字段的校验抽成私有方法（例如 `fn validate_title(&self, t: &str)`），`new` 和 setter 都调它。',
    h3: '`pub fn set_title(&mut self, title: String) { self.validate_title(&title); self.title = title; }`',
  },
  '03_ticket_v1/08_stack': {
    h1: '这题不问语义，只问「这个类型在栈上占几个字节」。',
    h2: '`u16` 是 2 字节，`i32` 是 4 字节，`bool` 是 1 字节 —— Rust 的 `bool` 占一整个字节，不是 1 bit。',
    h3: '三个空依次填 `2`、`4`、`1`，别留 `todo!()`。',
  },
  '03_ticket_v1/09_heap': {
    h1: '`String` 的字符内容不在栈上。栈上只放三样东西；`Ticket` 是几个 `String` 摞起来。',
    h2: '`String` = 指针 8 + 长度 8 + 容量 8 = 24 字节（64 位平台）；`Ticket` 里有三个 `String`。',
    h3: '`size_of::<String>()` 填 `24`，`size_of::<Ticket>()` 填 `72`。',
  },
  '03_ticket_v1/10_references_in_memory': {
    h1: '引用在内存里就是一个地址。它指向的东西多大，跟引用本身多大没有关系。',
    h2: '64 位平台上引用固定 8 字节，`&u16`、`&mut u64`、`&Ticket` 都一样大。',
    h3: '三个空都填 `8`。',
  },
  '03_ticket_v1/11_destructor': {
    h1: '这一节还没真正讲析构，题目只是让你返回一句固定的话。',
    h2: '和第一题一个套路：字符串字面量，返回 `&\'static str`。',
    h3: '`fn outro() -> &\'static str { "I have a basic understanding of destructors!" }`',
  },
  '03_ticket_v1/12_outro': {
    h1: '把这一章合起来：私有字段 + `new` 里校验 + 访问器 + setter。注意测试在 `tests/` 目录，**只有 pub 的东西它才看得见**。',
    h2: '`Order::new(...)` 直接返回 `Order`（不是 `Result`）；`quantity()` / `unit_price()` 返回的是**引用**（测试里写的是 `assert_eq!(order.quantity(), &3)`）；`total()` 返回数量 × 单价的乘积。',
    h3: '`pub fn quantity(&self) -> &u64 { &self.quantity }`、`pub fn total(&self) -> u64 { self.quantity * self.unit_price }`',
  },
};
