---
title: "Spring Boot Pre-interview Task Guide 2"
description: "Pre-interview 과제에서 자주 나오는 유형과 체크 포인트 정리"
pubDate: 2026-01-19
tags: ["Spring Boot", "REST API", "Backend", "Interview"]
heroImage: "../../assets/PreinterviewTaskGuide.png"
---

## 서론

[1편](https://rhcwlq89.github.io/blog/first-post)에 이어서 Spring Boot 기반의 Pre-interview 과제에서   
체크 포인트를 정리합니다.
2편은 YAML, @Configuration과 Test 입니다.

---

## Config
### DataBase

일반적으로 과제에서 제시하는 DB는 세 가지다.
   - Memory 기반 RDB (H2)
   - Memory(HashMap 등)
   - Docker 기반 RDB (MySQL, PostgreSQL 등)
   

1. 공통 설정 (application.yml)에서 관리
   - DB 접속 정보 (application.yml : url, jdbc driver, username, password)
   - JPA 설정
   
   <details>
   <summary>application.yml (DB Connection)</summary>
   
   ```yaml
    spring:
        datasource:
            url: jdbc:h2:mem:codetest;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE
            driver-class-name: org.h2.Driver
            username: sa
            password:
   ```
   
   </details>

    <details>
    <summary>Annotation-based Configuration</summary>

    ```kotlin
    @Configuration
    open class JpaConfig {
        private fun createEntityManagerFactoryBuilder(
            jpaProperties: JpaProperties
        ) : EntityManagerFactoryBuilder {
            val jpaVendorAdapter = createJpaVendorAdapter(jpaProperties)
            return EntityManagerFactoryBuilder(jpaVendorAdapter, jpaProperties.properties, null)
        }

        private fun createJpaVendorAdapter(
            jpaProperties: JpaProperties
        ): JpaVendorAdapter {
            val hibernateJpaVendorAdapter = HibernateJpaVendorAdapter()
            hibernateJpaVendorAdapter.setGenerateDdl(true)
            hibernateJpaVendorAdapter.setShowSql(true)
   
            jpaProperties.properties["hibernate.physical_naming_strategy"] =
                "org.hibernate.boot.model.naming.CamelCaseToUnderscoresNamingStrategy"
            jpaProperties.properties["hibernate.implicit_naming_strategy"] =
                "org.springframework.boot.orm.jpa.hibernate.SpringImplicitNamingStrategy"
            jpaProperties.properties["hibernate.hbm2ddl.auto"] = "create"
            jpaProperties.properties["hibernate.show_sql"] = "true"

            return HibernateJpaVendorAdapter()
        }


        @Bean
        fun entityManagerFactory(
            dataSource: DataSource,
            jpaProperties: JpaProperties,
        ): LocalContainerEntityManagerFactoryBean {
            val builder = createEntityManagerFactoryBuilder(jpaProperties)
            return builder.dataSource(dataSource)
                .packages("com.fastfive.product.domain")
                .build()
        }

        @Bean
        fun transactionManager(
            entityManagerFactory: EntityManagerFactory
        ): PlatformTransactionManager {
            val transactionManager = JpaTransactionManager()
            transactionManager.entityManagerFactory = entityManagerFactory
            return transactionManager
        }
    }
    ```

    </details>

2. H2 설정
    - H2 콘솔 활성화
    - JDBC URL 설정
    
    <details>
    <summary>application.yml (H2 설정)</summary>
    
    ```yaml
    spring:
        h2:
            console:
                enabled: true
                path: /h2
    ```
    </details>  

    <details>
    <summary>build.gradle</summary>
    </details>

   


