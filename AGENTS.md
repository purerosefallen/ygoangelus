# 注意事项（AGENTS.md）

本文件定义 nesties / nicot 后端项目中的通用工程规范与红线规则。
所有规则均为强制性规范，不得以“方便”“省代码”“习惯不同”为由绕过。

本规范适用于所有基于 NestJS + nicot + nesties 构建的后端项目。

## 项目定位与基本原则

- 本项目为标准后端 API 服务
- 对外接口以 DTO 作为唯一契约形式
- 明确区分：
  - 接口契约（DTO）
  - Controller（参数接收与返回）
  - Service（业务编排）
  - 基础设施（外部系统、数据库、缓存等）

核心原则：

- 显式优于隐式
- 稳定性优于省代码
- 契约优于实现细节


## Controller 层规范

- Controller 层只负责：
  - 接收参数（通过 DTO）
  - 返回标准返回结构（通过 DTO）
- Controller 层禁止：
  - 编写业务逻辑
  - 自行解析、转换输入参数
  - 返回未定义的结构或裸对象
  - 将外部系统 / 数据库实体的原始结构直接暴露给前端

Controller 必须保持“薄”，所有流程与判断应下沉到 Service。


## DTO 与接口规范（必须遵守）

DTO 是后端接口的对外契约，而非简单的类型工具。  
所有 DTO 相关规则均为强制性规范。

### 输入 DTO（Query / Body 通用规则）

- 所有接口的 Query 和 Body：
  - 必须定义为 DTO 类
  - 必须放在对应模块的 `*.dto.ts` 文件中
  - 必须携带：
    - class-validator 装饰器
    - ApiProperty（或变体）装饰器
- DTO 作为接口输入时：
  - Query 使用 `@DataQuery()`
  - Body 使用 `@DataBody()`

禁止事项：

- 禁止使用 `@Query()` / `@Body()` 直接接收原始对象
- 禁止使用 `any` 作为接口输入类型
- 禁止在 Controller 中自行解析、转换输入字段


### Query DTO 额外约束（重要）

#### 数据结构约束

- Query DTO 只能是一层扁平结构
- 不允许出现任何嵌套结构

禁止使用：

- 对象字段
- 数组字段
- Map / Record
- 任意嵌套 DTO


#### 字段类型约束

Query DTO 中的字段类型仅允许：

- string
- number
- Date
- enum（见 enum 使用规范）

禁止使用：

- boolean
- object
- array
- union / intersection
- 任意自定义复杂类型


#### Query 中的布尔语义（强制规则）

- Query 中不允许出现 boolean 类型字段
- 所有布尔语义必须使用 number 类型的 0 / 1 表示
- 布尔字段必须通过 ApiProperty 声明 enum 为 [0, 1]
- 在 Service 层解析时：
  - 必须使用 nesties（如果项目含有 nicot 则用 nicot）提供的 `parseBool(v: any): boolean`
- 禁止自行判断布尔语义（例如强转、比较字符串等）

该规则用于保证 Swagger 行为一致、URL 参数可预测、自动化调用稳定。


### enum 使用规范（强制）

该规则适用于 Query / Body / Response。

#### enum 的定义位置

- enum 仅在一个 DTO 文件中使用：
  - 允许定义在该 DTO 文件中
- enum 横跨多个 DTO 或多个文件使用：
  - 必须定义在独立的 `*.enum.ts` 文件中
  - 由 DTO 显式引用

禁止事项：

- 禁止跨文件复制 enum 定义
- 禁止在多个 DTO 文件中各自定义同名 enum


#### enum 的定义形式（严格约束）

- enum 必须使用字符串 enum
- enum 的 key 与 value 必须完全一致
- 命名使用 UpperCamelCase

允许形式示例（语义说明）：

- Foo = 'Foo'
- PendingReview = 'PendingReview'

禁止事项：

- 禁止使用数字 enum
- 禁止使用数字或字符串充当“伪 enum”
- 禁止 key 与 value 不一致


### 返回 DTO 规范

- 所有接口返回值必须定义 DTO 类
- 禁止直接返回外部系统、数据库实体或内部模型的原始结构
- 即使字段同名，也必须显式映射后返回
- 返回值必须通过标准返回结构封装，不允许随意返回裸对象


### DTO 复用规则

- DTO 的复用只允许发生在“结构层”，不得发生在“接口契约层”
- 允许定义公共基础 DTO 用于字段复用
- 接口使用的 DTO 必须定义在各自模块内

强制约束：

- Controller 禁止直接引用公共 DTO 作为 Query / Body / Response 类型
- 公共 DTO 不代表接口契约
- 不允许通过“字段看起来一样”隐式耦合不同接口或模块


### DTO 禁用项（重要）

- 禁止使用 `@nestjs/mapped-types`
  - 包括但不限于：PartialType、PickType、OmitType、IntersectionType

原因包括但不限于：

- Swagger 行为不稳定
- 校验规则与运行时行为不一致
- 容易引入隐式接口契约继承

如需字段复用：

- 必须显式定义 DTO 类
- 使用组合或显式继承完成


## HTTP 与 Swagger 规范

- 所有非 GET 接口必须显式指定 `@HttpCode(200)`
- 所有接口必须包含 `@ApiOperation`
  - summary：接口作用（必填）
  - description：注意事项（可选）
- 不需要在 Controller 中重复写 `@ApiQuery` 或 `@ApiBody`
  - 参数相关 Swagger 信息应由 DTO 与参数装饰器提供
- 非 RestfulFactory 生成的接口（即自己手写的路由）必须显式声明返回结构（成功响应）
  - 有返回数据：必须写 `@ApiTypeResponse(XxxDto)`（或对应的数组 / 分页变体）
  - 无返回数据：必须写 `@ApiBlankResponse()`
  - 由 RestfulFactory 自动生成的 CRUD 路由已自带返回声明，无需也不要重复
- 如果接口对应的 Service 代码中包含 `throw new ...`（即会主动抛出错误），则必须在 Controller 显式声明对应的错误响应
  - 每一个会抛出的非 2xx 状态码，都要有对应的 `@ApiError(status, message)`
  - 错误响应带有结构化数据时，使用 `@ApiErrorTyped(status, XxxDto, message)`
  - 鉴权 / 权限等由 resolver（如 admin、当前用户）统一注入的错误，无需在 Controller 重复声明
- Controller 中声明的 `ApiError` / `ApiErrorTyped` 必须与 Service 实际抛出的状态码、含义保持一致


## Entity 关系类型规范（NestJS 12 / ESM，必须遵守）

该规则适用于 TypeORM 的 `@OneToMany` / `@ManyToOne` 以及 NICOT 的
`@RelationComputed`。关系装饰器必须始终显式传入延迟求值的目标类型
`() => T`，属性类型则按集合性区分：

- `OneToMany` 等集合关系必须写成 `T[]`。
- `ManyToOne` 等单值关系必须写成 `Relation<T>`，并通过
  `import { type Relation } from 'typeorm'` 导入类型。
- 禁止把单值关系直接写成 `T`。在 ESM 循环依赖中，这可能发射
  `design:type = T`，并在对端 class 初始化前触发 temporal dead zone 错误。

```ts
import { Entity, ManyToOne, OneToMany, type Relation } from 'typeorm';

@Entity()
export class Author extends IdBase() {
  @OneToMany(() => Article, article => article.author)
  articles: Article[];
}

@Entity()
export class Article extends IdBase() {
  @ManyToOne(() => Author, author => author.articles)
  author: Relation<Author>;
}
```

普通 TypeORM relation 的目标类型和集合性优先来自显式 callback 与 TypeORM
metadata，因此不要求 `design:type` 直接引用目标 class。

NICOT 的 `@RelationComputed` 还必须遵守：

- 始终显式写 `@RelationComputed(() => T)`。
- 单值计算关系使用 `Relation<T>`。
- 集合计算关系必须直接使用 `T[]`，禁止使用 `Relation<T[]>`。

这是因为当前 NICOT 通过 `design:type === Array` 判断计算关系是否为集合；
`Relation<T[]>` 会发射 `Object`，从而被误判为单值关系。

```ts
@NotColumn()
@RelationComputed(() => Article)
bestArticle: Relation<Article>;

@NotColumn()
@RelationComputed(() => Article)
recentArticles: Article[];
```


## 分层与依赖约束

- Controller 层：
  - 只处理接口输入输出
- Service 层：
  - 负责业务编排与流程控制
- 基础设施层：
  - 负责外部系统与底层能力（数据库、缓存、消息等）

禁止出现跨层污染或职责混用，例如：

- Controller 直接访问基础设施
- Controller / Service 将内部实体原样作为响应返回
- 将输入解析逻辑散落在 Controller 中

## 关于 lint

- 完成每次任务之后，无论 lint 结果如何，不要尝试手动修复 lint 错误，而是先运行一次 npm run lint 来自动修复大部分问题。

## 关于 jest 和测试

- e2e 测试过程需要 override 掉 ConfigService 使得变成本机起的 postgres 等测试环境。
- 在 test 下写一个 docker-compose.yml 在本机起对应的 postgres 等测试环境。测试的时候再启动，测试之后关闭。

## 参考（只读）

以下项目用于理解 nesties 的行为，不得直接修改或复制实现：

- nesties: /home/nanahira/test/nesties
- nicot: /home/nanahira/test/nicot
